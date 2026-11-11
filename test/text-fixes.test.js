// Regression tests for text bugs found by the learner (run: npm test).
// Each case is a real sentence or word from an article that came out wrong.
// No network, no API calls.

const test = require('node:test');
const assert = require('node:assert/strict');

const { convertScript } = require('../agent/middleware/script-converter');
const { _internals: { normalizeNumbers } } = require('../agent/middleware/normalize');
const { lookupLevel } = require('../agent/middleware/jlpt-levels');
const { applyProperNouns } = require('../agent/middleware/proper-nouns');
const { spellOutNumbers, _internals: { fixStoredSpelling } } = require('../agent/middleware/spell-numbers');
const { _internals: { sentenceCount } } = require('../agent/middleware/quality-reviewer');

const romaji = text => convertScript(text, 'romaji');

test('particle ni before a counter is not the number 2 (#211)', () => {
  assert.equal(normalizeNumbers('jibun no suki na yō ni jikan wo tsukau', 'romaji'), 'jibun no suki na yō ni jikan wo tsukau');
  assert.equal(normalizeNumbers('Tōkyō ni jikan ga kakaru', 'romaji'), 'Tōkyō ni jikan ga kakaru');
  assert.equal(normalizeNumbers('nijikan benkyō shimashita', 'romaji'), '2-jikan benkyō shimashita');
  assert.equal(normalizeNumbers('ni-nen mae', 'romaji'), '2-nen mae');
  assert.equal(normalizeNumbers('sanjū nin', 'romaji'), '30-nin');
});

test('JLPT levels for words the list spells differently', () => {
  assert.equal(lookupLevel({ word_kanji: '出来る', word_kana: 'できる' }), 'N5');   // was N1 via 出切る
  assert.equal(lookupLevel({ word_kanji: '下がる', word_kana: 'さがる' }), 'N4');   // was N1
  assert.equal(lookupLevel({ word_kanji: '上がる', word_kana: 'あがる' }), 'N4');
  assert.equal(lookupLevel({ word_kanji: '沢山', word_kana: 'たくさん' }), 'N5');
  assert.equal(lookupLevel({ word_kanji: '連立', word_kana: 'れんりつ' }), 'N1');   // really N1
  assert.equal(lookupLevel({ word_kanji: '任期', word_kana: 'にんき' }), null);      // homophone stays unresolved
});

test('foreign sounds in Hepburn (#211 "vyira")', () => {
  assert.equal(romaji('新（あたら）しいヴィラを作（つく）りました。'), 'Atarashii vira wo tsukurimashita.');
  assert.equal(romaji('パーティーに行（い）きます。'), 'Pātī ni ikimasu.');
  assert.equal(romaji('ファンが多（おお）いです。'), 'Fan ga ōidesu.');
  assert.equal(romaji('東京（とうきょう）ディズニーランド'), 'Tōkyō dizunīrando');
  assert.equal(romaji('コーヒーを飲（の）みます。'), 'Kōhī wo nomimasu.');
  assert.equal(romaji('不安（ふあん）です。'), 'Fuan desu.');                   // native fu-an untouched
});

test('spaces at word boundaries and yō na / yō ni (#211)', () => {
  assert.equal(romaji('場所（ばしょ）はプリンス・グランド・リゾート軽井沢（かるいざわ）です。'), 'Basho wa purinsu gurando rizōto karuizawa desu.');
  assert.equal(romaji('自分（じぶん）の家（いえ）のような部屋（へや）です。'), 'Jibun no ie no yō na heya desu.');
  assert.equal(romaji('自分（じぶん）の好（す）きなように時間（じかん）を使（つか）います。'), 'Jibun no suki na yō ni jikan wo tsukaimasu.');
  assert.equal(romaji('日本（にほん）のようになりました。'), 'Nihon no yō ni narimashita.');
  assert.equal(romaji('スタートしました。'), 'Sutāto shimashita.');
  assert.equal(romaji('家賃（やちん）は 上（あ）がらない と 思（おも）われて いました。'), 'Yachin wa agaranai to omowarete imashita.');
});

test('stored articles are corrected on display', () => {
  assert.equal(fixStoredSpelling('atarashii vyira no hoteru'), 'atarashii vira no hoteru');
  assert.equal(fixStoredSpelling('jibun no ie no yōna heya'), 'jibun no ie no yō na heya');
  assert.equal(fixStoredSpelling('noyōni'), 'no yō ni');
  assert.equal(fixStoredSpelling('kyōni'), 'kyōni');
  assert.equal(spellOutNumbers('1hitoheya no yachin wa 6man6027en'), 'Hitoheya no yachin wa rokuman rokusen nijūnanaen');
});

test('proper nouns get capitals only where the letters match', () => {
  const names = [
    { ja: 'プリンス・グランド・リゾート軽井沢', romaji: 'Purinsu Gurando Rizoto Karuizawa' },
    { ja: '軽井沢', romaji: 'Karuizawa' },
    { ja: '長野県', romaji: 'Nagano-ken' },
    { ja: '誤', romaji: 'Karuizava' },   // wrong spelling from the model: must not be applied
  ];
  assert.equal(
    applyProperNouns('Basho wa purinsugurandorizōtokaruizawa desu. Naganoken no karuizawa. Karuizawasan.', names),
    'Basho wa Purinsu Gurando Rizōto Karuizawa desu. Nagano-ken no Karuizawa. Karuizawasan.'
  );
});

test('reviewer safety net counts sentences', () => {
  assert.equal(sentenceCount('A desu. B desu. C desu.'), 3);
  assert.equal(sentenceCount(''), 0);
});
