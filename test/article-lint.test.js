// Regression tests for reader-reported article problems.
//
// RULE: every problem a reader reports gets a case here (and a rule in
// agent/middleware/article-lint.js, or a fix in the converter / number
// speller). The sentence is copied from the stored article, so the exact
// mistake can never come back unnoticed.

const test = require('node:test');
const assert = require('node:assert');
const { lintArticle, lintDraft, formatForReviewer } = require('../agent/middleware/article-lint');
const { spellOutNumbers, fixStoredSpelling } = require('../agent/middleware/spell-numbers');
const { convertScript } = require('../agent/middleware/script-converter');
const { capitalizeKnownNames } = require('../agent/middleware/proper-nouns');

const shown = t => spellOutNumbers(fixStoredSpelling(capitalizeKnownNames(t)));
const rules = (body, level = 'N4') => lintArticle({ body_romaji: body }, { proficiency_level: level }).map(f => f.rule);

// --- A. Fixed in code: the reader never sees these again, old articles included ---
test('display: digits are always spelled out (#217, #219)', () => {
  assert.strictEqual(shown('Raman san wa 44ninme no shichō desu.'), 'Raman-san wa yonjūyoninme no shichō desu.');
  assert.strictEqual(shown('saisho no 100nichi no keikaku'), 'Saisho no hyakunichi no keikaku');
  assert.strictEqual(shown('16gōki wa Furorida e iku'), 'Jūrokugōki wa Furorida e iku');
  assert.strictEqual(shown('Soshite, 26(nijūroku) no eisei wo dashimashita.'), 'Soshite, nijūroku no eisei wo dashimashita.');
  assert.strictEqual(shown('Enjin 33(sanjūsan) mo nakunarimashita.'), 'Enjin sanjūsan mo nakunarimashita.');
  assert.strictEqual(shown('1ninme to 4ninme'), 'Hitorime to yoninme');
  // must stay as they are
  assert.strictEqual(shown('5G to 4k to 100km to M6'), '5G to 4k to 100km to M6');
});

test('display: name + san gets a hyphen, names get capitals (#216, #218, #219)', () => {
  assert.strictEqual(shown('Basu san wa ikkai dake shichō deshita.'), 'Basu-san wa ikkai dake shichō deshita.');
  assert.strictEqual(shown('Kono san nin wa'), 'Kono san nin wa');   // "san" = three
  assert.strictEqual(shown('hajimete no ajia kei Amerika jin no shichō'), 'Hajimete no Ajia-kei Amerikajin no shichō');
  assert.strictEqual(shown('fan ga nihongo wo renshū shimasu'), 'Fan ga Nihongo wo renshū shimasu');
  assert.strictEqual(shown('ATM ga nihon ni arimasu'), 'ATM ga Nihon ni arimasu');
  assert.strictEqual(shown('nihonshu wo nomimasu'), 'Nihonshu wo nomimasu');   // only the sentence start
});

test('converter: the same mistakes are not produced any more', () => {
  assert.strictEqual(convertScript('ラマンさんは市長（しちょう）です。', 'romaji'), 'Raman-san wa shichō desu.');
  assert.strictEqual(convertScript('赤沢（あかざわ）さんは話（はな）しました。', 'romaji'), 'Akazawa-san wa hanashimashita.');
  assert.match(convertScript('26（にじゅうろく）の衛星（えいせい）を出（だ）しました。', 'romaji'), /^26 no eisei wo dashimashita\.$/);
  assert.match(convertScript('アジア系（けい）アメリカ人（じん）です。', 'romaji'), /ajiakei amerikajin desu/i);
  assert.match(convertScript('利用（りよう）します。', 'romaji'), /riyō shimasu/i);
});

// --- B. Caught by the code check and handed to the reviewer ---
test('lint: sentence fragment (#217)', () => {
  assert.ok(rules('Supēsu X wa seikō shimashita. Tekisasu no Sutābēsu de. Roketto wa tobimashita.').includes('fragment'));
  assert.ok(!rules('Tekisasu no Sutābēsu de roketto wo tsukamaemashita.').includes('fragment'));
});

test('lint: grammar above N4 (#217, #219)', () => {
  assert.ok(rules('Yaku 6-nen mae ni, atarashii hito toshite shi no shigoto wo hajimemashita.').includes('grammar-level'));
  assert.ok(rules('16gōki wa Furorida e iku yotei da to iwarete imasu.').includes('grammar-level'));
  assert.ok(rules('Kore wa kodomo ni totte ii koto desu.').includes('grammar-level'));
  // fine at N4: "trying to", and N3 learners may read these
  assert.ok(!rules('Kaisha wa atarashii mise wo tsukurō to shite imasu.').includes('grammar-level'));
  assert.ok(!rules('Kore wa kodomo ni totte ii koto desu.', 'N3').includes('grammar-level'));
});

test('lint: word-for-word English and vague stand-ins (#214, #216, #218, #219)', () => {
  for (const s of [
    'Nihon no kuni wa AI no apuri wo tsukuru keikaku wo tatemashita.',
    'Yaku 6-nen mae ni, atarashii hito toshite shi no shigoto wo hajimemashita.',
    'MUFG Ginkō wa gurūpu no yunitto desu.',
    'Tsumari, sono hito ka dōka mimasu.',
    'Kore wa nishi no kuni no rūru e no kotae desu.',
  ]) assert.ok(rules(s).includes('calque'), s);
  assert.ok(!rules('Nihon no seifu wa keikaku wo tatemashita.').includes('calque'));
});

test('lint: sentence about the source, and repetition (#217, #218)', () => {
  assert.ok(rules('Japan taimuzu wa 11gatsu 9ka ni kono nyūsu wo kakimashita.').includes('meta'));
  assert.ok(rules('Nihon no kuni wa AI no apuri wo tsukuru keikaku wo tatemashita. Fan wa renshū shimasu. Kuni wa apuri wo tsukuru yotei desu.').includes('repeat'));
  assert.ok(rules('Keikaku wa, būsutā to shippu wo futatsu tomo tsukamaeru koto deshita. Dakara, futatsu tomo tsukamaeru koto wa dekimasen deshita.').includes('repeat'));
  // two different facts about the same person are not a repetition
  assert.ok(!rules('Raman-san wa Rosanzerusu no shichō ni narimasu. Raman-san wa Karen Basu shichō ni kachimashita.').includes('repeat'));
});

test('lint: long loanword in the draft (#219)', () => {
  const f = lintDraft('彼女（かのじょ）はデモクラティック・ソーシャリストです。スマートフォンのアプリです。ロサンゼルスの市長（しちょう）です。',
    [{ ja: 'ロサンゼルス', romaji: 'Rosanzerusu' }], w => convertScript(w, 'romaji'));
  assert.deepStrictEqual(f.map(x => x.quote.toLowerCase()), ['demokuratikku', 'sōsharisuto']);
});

test('lint: a clean article has no findings, and the reviewer block is empty', () => {
  const body = 'Mitsubishi UFJ wa atarashii ginkō wo [NEW] happyō shimashita. Kono ginkō wa kādo wo tsukurimasen. Okyaku-san wa sumaho no apuri wo tsukaimasu.';
  assert.deepStrictEqual(rules(body), []);
  assert.strictEqual(formatForReviewer([]), '');
  assert.match(formatForReviewer(lintArticle({ body_romaji: 'Tekisasu no Sutābēsu de.' })), /CODE CHECK[\s\S]*fragment/);
});
