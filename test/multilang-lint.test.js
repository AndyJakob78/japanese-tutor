// Tests for the German / English code check (multilang/lint.js).
// RULE (same as for Japanese): every problem a reader reports gets a line in
// multilang/languages/<lang>.js and a case here.

const test = require('node:test');
const assert = require('node:assert');
const { lintArticle, formatForReviewer, tidy, syncGrammarNote, cleanQuiz, checkQuiz, splitSentences } = require('../multilang/lint');
const de = require('../multilang/languages/de');
const en = require('../multilang/languages/en');

const rules = (lang, level, body) => lintArticle({ body }, lang, level).map(f => f.rule);

test('sentence splitter: dates and abbreviations are not sentence ends', () => {
  assert.strictEqual(splitSentences('Das Fest beginnt am 21. November. Es dauert ca. 3 Tage.', de).length, 2);
  assert.strictEqual(splitSentences('The U.S. team won. Mr. Smith was happy.', en).length, 2);
  assert.strictEqual(splitSentences('She is 44. He is 50.', en).length, 2);
  // first test run: "2016/17." is a sentence end, and so is a paragraph break
  assert.strictEqual(splitSentences('Die letzte war 2016/17. Computer haben Probleme.\n\nDie Erde dreht sich', de).length, 3);
  assert.strictEqual(splitSentences('Das ist die 31. Konferenz. Sie beginnt heute.', de).length, 2);
});

test('German A1-A2: simple past, relative clause, B1 connectors, genitive', () => {
  assert.ok(rules(de, 'A1-A2', 'Der Minister sagte am Montag etwas Neues.').includes('tense'));
  assert.ok(rules(de, 'A1-A2', 'Die Preise stiegen im Oktober wieder.').includes('tense'));
  assert.ok(rules(de, 'A1-A2', 'Die Brücke wurde im Sommer gebaut.').includes('tense'));
  assert.ok(rules(de, 'A1-A2', 'Die Firma, die in Berlin ist, baut ein Haus.').includes('grammar-level'));
  assert.ok(rules(de, 'A1-A2', 'Sie kommen, obwohl es regnet.').includes('grammar-level'));
  assert.ok(rules(de, 'A1-A2', 'Wegen des Wetters fahren heute keine Züge.').includes('grammar-level'));
  assert.ok(rules(de, 'A1-A2', 'Jetzt dürfen die Weltzeit und die Zeit der Sonne abweichen.').includes('grammar-level')); // first test run
  assert.ok(rules(de, 'A1-A2', 'Die Stadt wird eine Schule bauen.').includes('grammar-level'));
  assert.ok(!rules(de, 'A1-A2', 'Der Darm wird schwächer.').includes('grammar-level')); // "becomes" is fine
  // allowed at A1-A2
  assert.deepStrictEqual(rules(de, 'A1-A2', 'Der Minister hat am Montag etwas gesagt. Das Wetter war schlecht. Viele Leute konnten nicht fahren, weil kein Zug gekommen ist.'), []);
  // the same sentences are fine at B1
  assert.deepStrictEqual(rules(de, 'B1', 'Der Minister sagte am Montag etwas Neues. Die Firma, die in Berlin ist, baut ein Haus.'), []);
});

test('German: reported-speech subjunctive up to B1, English-style year, long sentence, fragment', () => {
  assert.ok(rules(de, 'B1', 'Der Chef sagte, er habe keine Zeit.').includes('grammar-level'));
  assert.ok(!rules(de, 'B2', 'Der Chef sagte, er habe keine Zeit.').includes('grammar-level'));
  assert.ok(rules(de, 'B2', 'Die Firma hat in 2026 viel Geld verdient.').includes('calque'));
  assert.ok(rules(de, 'A1-A2', 'Die Stadt baut im nächsten Jahr eine neue große Schule für alle Kinder aus dem Norden und dem Süden.').includes('long-sentence'));
  assert.ok(rules(de, 'A1-A2', 'Die Züge fahren nicht. Weil es zu viel Schnee gibt.').includes('fragment'));
});

test('English A1-A2: past perfect, connectors, "would", contractions, -ing clause', () => {
  assert.ok(rules(en, 'A1-A2', 'The team had won the game before.').includes('tense'));
  assert.ok(rules(en, 'A1-A2', 'The road has been closed since Monday.').includes('tense'));
  assert.ok(rules(en, 'A1-A2', 'Although it rained, people came.').includes('grammar-level'));
  assert.ok(rules(en, 'A1-A2', 'The city would build a new park.').includes('grammar-level'));
  assert.ok(!rules(en, 'A1-A2', 'Many people would like a new park.').includes('grammar-level'));
  assert.ok(rules(en, 'A1-A2', "The shop doesn't open today.").includes('contraction'));
  assert.ok(rules(en, 'B1', 'The mayor spoke on Monday, saying that the plan was ready.').includes('grammar-level'));
  assert.deepStrictEqual(rules(en, 'A1-A2', 'The city opened a new park on Monday. Many people came because the weather was good. The mayor said that the park is free.'), []);
  assert.deepStrictEqual(rules(en, 'B1', 'Although it rained, people came. The team had won the game before.'), []);
});

test('English: newspaper short words and repeated facts at every level', () => {
  assert.ok(rules(en, 'B2', 'The minister vowed to act amid rising prices.').includes('journalese'));
  assert.ok(rules(en, 'B1', 'The company plans to open twenty stores in Japan next year. Next year the company plans to open twenty stores in Japan.').includes('repeat'));
  assert.ok(!rules(en, 'B1', 'The company plans to open twenty stores in Japan next year. The stores sell cheap furniture and kitchen tools.').includes('repeat'));
});

test('vocabulary: markers and list must match; German nouns need an article', () => {
  const art = {
    body: 'Die [NEW] Regierung plant ein [NEW] Gesetz.',
    translation_ja: '政府は法律を計画しています。',
    vocabulary: [
      { word: 'Regierung', base: 'Regierung', pos: 'noun', meaning_ja: '政府' },
      { word: 'Gesetz', base: 'das Gesetz, -e', pos: 'noun', meaning_ja: 'law' },
      { word: 'Steuer', base: 'die Steuer, -n', pos: 'noun', meaning_ja: '税金' },
    ],
  };
  const found = lintArticle(art, de, 'A1-A2').map(f => `${f.rule}:${f.quote}`);
  assert.ok(found.includes('vocab-form:Regierung'));
  assert.ok(found.includes('vocab-meaning:Gesetz'));
  assert.ok(found.includes('vocab-mismatch:Steuer'));
  // tidy drops the entry that is not in the body, and a marker without an entry
  const t = tidy({ body: 'Die [NEW]Regierung plant ein [NEW] Gesetz.', vocabulary: [art.vocabulary[0]] });
  assert.strictEqual(t.body, 'Die [NEW] Regierung plant ein Gesetz.');
  assert.strictEqual(tidy(art).vocabulary.length, 2);
});

test('reviewer block and quiz check', () => {
  assert.strictEqual(formatForReviewer([]), '');
  assert.match(formatForReviewer(lintArticle({ body: 'Der Minister sagte etwas.' }, de, 'A1-A2')), /CODE CHECK[\s\S]*Perfekt/);
  const good = { type: 'comprehension', instruction_ja: '選んでください。', question: 'Was plant die Stadt?', options: ['einen Park', 'eine Schule', 'eine Brücke', 'ein Museum'], answer_index: 1, explanation_ja: '記事に「Schule」とあります。' };
  assert.deepStrictEqual(checkQuiz({ questions: [good, good, good, good, good, good] }), []);
  assert.strictEqual(checkQuiz({ questions: [good, good, good, good] }).length, 1); // six are needed
  const bad = { ...good, options: ['a', 'a', 'b', 'c'], answer_index: 4, explanation_ja: 'because' };
  assert.strictEqual(checkQuiz({ questions: [good, good, good, good, good, bad] }).length, 3);
});

test('found in the first test run: stale grammar sentence, [NEW] in the quiz, checks the reviewer cannot act on', () => {
  const art = { body: 'Die Uhr geht falsch. Jetzt dürfen die Zeiten bis zu einer Stunde abweichen.', grammar_note: { point: 'dürfen', sentence: 'Jetzt dürfen die Zeiten bis zu 1 Stunde abweichen.' } };
  assert.strictEqual(syncGrammarNote(art, de).grammar_note.sentence, 'Jetzt dürfen die Zeiten bis zu einer Stunde abweichen.');
  assert.strictEqual(syncGrammarNote({ ...art, body: 'Die Uhr geht falsch.' }, de).grammar_note, null);
  assert.strictEqual(cleanQuiz({ questions: [{ question: 'He has a long [NEW] bill.', options: ['a', 'b'] }] }).questions[0].question, 'He has a long bill.');
  assert.strictEqual(formatForReviewer([{ rule: 'too-few-new', quote: 'x', hint: 'y' }, { rule: 'too-long', quote: 'x', hint: 'y' }]), '');
  // Japanese may use more or fewer sentences; only a big gap is reported
  const ja = n => 'これは文です。'.repeat(n);
  const body = 'The bird flew far. '.repeat(15).trim();
  assert.ok(!lintArticle({ body, translation_ja: ja(18) }, en, 'B2').some(f => f.rule === 'translation'));
  assert.ok(lintArticle({ body, translation_ja: ja(8) }, en, 'B2').some(f => f.rule === 'translation'));
  assert.ok(lintArticle({ body: 'The bird flew very far away today. '.repeat(40) }, en, 'A1-A2').some(f => f.rule === 'too-long'));
});

test('word levels: a hard word that is not marked is found', () => {
  const { makeLookup, parseCefrj, parseFrequency, namesFrom, _internals } = require('../multilang/wordlevel');
  // English: CEFR-J format
  const enWords = makeLookup(en, parseCefrj('headword,pos,CEFR\nthe,det,A1\nbird,noun,A1\nfly,verb,A1\nbe,verb,A1\nvery,adv,A1\nfar,adv,A1\ncity,noun,A1\nto,prep,A1\nmigrate,verb,B2\nsun,noun,A1\npower,noun,A2'));
  assert.ok(enWords.known('flew', 'A1-A2') && enWords.known('cities', 'A1-A2') && enWords.known('birds', 'A1-A2'));
  assert.ok(!enWords.known('migrates', 'A1-A2') && enWords.known('migrates', 'B2'));
  assert.ok(_internals.englishCandidates('stopped').includes('stop') && _internals.englishCandidates('making').includes('make'));
  const names = namesFrom({ topic: 'A bird named Phil flew to Siberia.' });
  const art = { body: 'Phil is a bird. The birds migrate very far to Siberia. The [NEW] godwit flew to the city.', vocabulary: [{ word: 'godwit', meaning_ja: 'シギ' }] };
  const hard = lintArticle(art, en, 'A1-A2', { words: enWords, names }).filter(f => f.rule === 'hard-word').map(f => f.quote);
  assert.deepStrictEqual(hard, ['migrate']);
  assert.deepStrictEqual(lintArticle(art, en, 'B2', { words: enWords, names }).filter(f => f.rule === 'hard-word'), []);
  // without data the check is skipped
  assert.deepStrictEqual(lintArticle(art, en, 'A1-A2').filter(f => f.rule === 'hard-word'), []);
  // German: position in a frequency list; a compound of two known words is known
  const lang = { ...de, levels: { ...de.levels, 'A1-A2': { ...de.levels['A1-A2'], knownRank: 5 } } };
  const deWords = makeLookup(lang, parseFrequency('die 9\nuhr 8\nzeit 7\ncomputer 6\nsystem 5\nregelmäßig 1'));
  assert.ok(deWords.known('Uhr', 'A1-A2') && deWords.known('Uhrzeit', 'A1-A2') && deWords.known('Computersystem', 'A1-A2'));
  assert.ok(!deWords.known('regelmäßig', 'A1-A2'));
  // endings: plural with umlaut, verb forms, adjective endings
  const w2 = makeLookup(lang, parseFrequency('land 9\nweichen 8\nneu 7\nxx 1\nyy 1\nselten 1'));
  assert.ok(w2.known('Länder', 'A1-A2') && w2.known('weicht', 'A1-A2') && w2.known('neuen', 'A1-A2') && !w2.known('selten', 'A1-A2'));
  // two forms of one word give one vocabulary entry, and the second marker goes
  const t = tidy({ body: 'Die [NEW] astronomische Zeit und der [NEW] astronomischen Uhr.', vocabulary: [{ word: 'astronomische', base: 'astronomisch' }, { word: 'astronomischen', base: 'astronomisch' }] });
  assert.strictEqual(t.vocabulary.length, 1);
  assert.strictEqual(t.body, 'Die [NEW] astronomische Zeit und der astronomischen Uhr.');
});

test('the pipeline files load (a syntax error once slipped through because no test loaded them)', () => {
  const g = require('../multilang/generate');
  assert.strictEqual(typeof g.generate, 'function');
  assert.deepStrictEqual(Object.keys(g.LANGS), ['de', 'en']);
});
