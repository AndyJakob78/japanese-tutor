// Tests for the 2026-11-21 learning changes: when a word counts as "known",
// fixed mistake patterns, and "0 new words".

const test = require('node:test');
const assert = require('node:assert');
const { applyTestResult } = require('../server/services/word-schedule');
const { summarizeWeakSpots, patternKeyOf, PATTERNS } = require('../server/services/mistakes');

const DAY = 864e5;
const T0 = Date.parse('2026-11-21T10:00:00Z');
const step = (w, correct, mode, now) => ({ ...w, ...applyTestResult(w, correct, mode, now) });

test('multiple choice never makes a word known', () => {
  let w = { status: 'learning' };
  for (let i = 0; i < 10; i++) w = step(w, true, 'choice', T0 + i * DAY);
  assert.strictEqual(w.status, 'learning');
  assert.deepStrictEqual([w.times_tested, w.times_tested_correct, w.times_recalled, w.streak_correct], [10, 10, 0, 10]);
  // an app version before 1.5 sends no mode — treated as multiple choice
  assert.strictEqual(step({ status: 'learning' }, true, undefined, T0).status, 'learning');
});

test('typed recall on two different days makes a word known, then it is spaced out', () => {
  let w = step({ status: 'learning' }, true, 'typed', T0);
  w = step(w, true, 'typed', T0 + 3600e3);                 // same day again: not yet
  assert.strictEqual(w.status, 'learning');
  w = step(w, true, 'sentence', T0 + DAY);                 // next day, used in an own sentence
  assert.strictEqual(w.status, 'known');
  assert.strictEqual(w.next_review_at, new Date(T0 + 2 * DAY).toISOString()); // back in 1 day
  // each further recall moves it on: 3, 7, 14 days, then mastered
  const gaps = [];
  for (let i = 0; i < 3; i++) { const now = T0 + (10 + i) * DAY; w = step(w, true, 'typed', now); gaps.push(Math.round((Date.parse(w.next_review_at) - now) / DAY)); }
  assert.deepStrictEqual(gaps, [3, 7, 14]);
  w = step(w, true, 'typed', T0 + 40 * DAY);
  assert.strictEqual(w.status, 'mastered');
  // a multiple-choice answer on a known word does not move its review date
  const known = { status: 'known', next_review_at: 'X', streak_correct: 2, recall_streak: 1 };
  assert.strictEqual(step(known, true, 'choice', T0).next_review_at, 'X');
});

test('wrong answers move a word back', () => {
  assert.strictEqual(step({ status: 'mastered', streak_correct: 9 }, false, 'choice', T0).status, 'known');
  let w = step({ status: 'known', streak_correct: 3, recall_streak: 3 }, false, 'typed', T0);
  assert.deepStrictEqual([w.status, w.streak_correct, w.recall_streak], ['known', 0, 0]); // first miss: stays, due tomorrow
  w = step(w, false, 'typed', T0 + DAY);
  assert.strictEqual(w.status, 'learning');                                             // second miss in a row
});

test('mistakes are filed under fixed patterns, so repeats add up', () => {
  const m = (type, pattern, wrote, correct, extra = {}) => ({ type, pattern, wrote, correct, why: '', corrected: '', created_at: '2026-11-20T00:00:00Z', ...extra });
  const mistakes = [
    m('particle', 'wa → ga for the subject doing the action', 'wa', 'ga'),
    m('particle', 'ga → wa for negative topic with mada', 'mada ga arimasen', 'wa mada arimasen'),
    m('particle', 'missing ga with aru (existence)', 'Airtag attara', 'AirTag ga attara'),
    m('particle', 'missing wo before transitive verb', 'junbi tsuzukette', 'junbi wo tsuzukete'),
    m('verb_form', 'te-form of ru-verb drops ru, no extra tsu', 'tsuzukette', 'tsuzukete'),
    m('word_choice', 'hiraku → akeru for opening a door', 'hirakimasu', 'akemasu'),
    m('particle', 'something new', 'x', 'y', { pattern_key: 'ni-de' }),   // new mistakes carry their key
  ];
  assert.deepStrictEqual(mistakes.map(patternKeyOf), ['wa-ga', 'wa-ga', 'wa-ga', 'object-wo', 'te-form', 'verb-pair', 'ni-de']);
  const spots = summarizeWeakSpots(mistakes);
  assert.deepStrictEqual([spots[0].pattern_key, spots[0].count], ['wa-ga', 3]);
  assert.strictEqual(spots[0].pattern, PATTERNS.find(p => p.key === 'wa-ga').label);
  assert.strictEqual(patternKeyOf(m('adjective', 'unknown thing', 'a', 'b')), 'i-adjective'); // fallback by type
});

test('"0 new words" is a real setting and brings more review words', () => {
  const { _internals: { newWordTarget, reviewWordTarget } } = require('../agent/pipeline');
  assert.strictEqual(newWordTarget({ new_words_per_article: 0 }), 0);
  assert.strictEqual(newWordTarget({ new_words_per_article: '0' }), 0);
  assert.strictEqual(newWordTarget({ new_words_per_article: 8 }), 8);
  assert.strictEqual(newWordTarget({}), 12);
  assert.strictEqual(reviewWordTarget({ new_words_per_article: 8 }), '5-8');
  assert.strictEqual(reviewWordTarget({ new_words_per_article: 2 }), '8-11');
  assert.strictEqual(reviewWordTarget({ new_words_per_article: 0 }), '10-13');
});

test('known words: a [NEW] word the learner has becomes [REVIEW], unmarked known words get marked', () => {
  const { markKnownWords, isName } = require('../agent/middleware/known-words');
  const vocab = [
    { word_romaji_macron: 'kimeru', part_of_speech: 'verb', meaning_en: 'to decide' },
    { word_romaji_macron: 'nedan', part_of_speech: 'noun', meaning_en: 'price' },
    { word_romaji_macron: 'harau', part_of_speech: 'verb', meaning_en: 'to pay' },
    { word_romaji_macron: 'sukinosu', part_of_speech: 'noun', meaning_en: 'Skinos (company name)' },
    { word_romaji_macron: 'fueru', part_of_speech: 'verb', meaning_en: 'to increase' },
    { word_romaji_macron: 'yotei', part_of_speech: 'noun', meaning_en: 'plan' },
    { word_romaji_macron: 'ken', part_of_speech: 'noun', meaning_en: 'prefecture' },
  ];
  const article = () => ({
    body_romaji: 'Kaisha wa basho wo uru koto wo [NEW] kimemashita. [NEW] Nedan wa mada wakarimasen. Sukinosu wa okane wo haraimasu. Okane ga fueru yotei desu. Nagano-ken no nedan desu. [NEW] Shichō ga kimashita.',
    newWords: [{ word_romaji_macron: 'kimeru' }, { word_romaji_macron: 'nedan' }, { word_romaji_macron: 'shichō' }], reviewWords: [],
  });
  const a = article();
  const r = markKnownWords(a, vocab, { maxReview: 8 });
  assert.deepStrictEqual(r, { converted: ['kimeru', 'nedan'], added: ['harau', 'fueru', 'yotei'] });
  assert.strictEqual(a.body_romaji, 'Kaisha wa basho wo uru koto wo [REVIEW] kimemashita. [REVIEW] Nedan wa mada wakarimasen. Sukinosu wa okane wo [REVIEW] haraimasu. Okane ga [REVIEW] fueru [REVIEW] yotei desu. Nagano-ken no nedan desu. [NEW] Shichō ga kimashita.');
  assert.deepStrictEqual(a.newWords.map(w => w.word_romaji_macron), ['shichō']);          // a really new word stays new
  assert.strictEqual(a.reviewWords.find(w => w.word_romaji_macron === 'harau').context_sentence, 'Sukinosu wa okane wo haraimasu.');
  // the limit holds, names and very short words are never marked
  const b = article();
  assert.deepStrictEqual(markKnownWords(b, vocab, { maxReview: 3 }).added, ['harau']);
  assert.ok(isName(vocab[3]) && !isName(vocab[1]));
  assert.ok(!a.body_romaji.includes('[REVIEW] Sukinosu') && !a.body_romaji.includes('[REVIEW] ken'));
  // a word inside a name is not marked
  const c = { body_romaji: 'Nagano Hoteru Saihokukan wa kaisha desu.', newWords: [], reviewWords: [] };
  assert.deepStrictEqual(markKnownWords(c, [{ word_romaji_macron: 'hoteru', part_of_speech: 'noun', meaning_en: 'hotel' }]).added, []);
});
