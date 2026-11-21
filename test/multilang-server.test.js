// Tests for the German / English API (multilang/server.js + store.js).
// They run against a fake in-memory database — the live one is never touched.

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createMiddleware } = require('../multilang/server');
const { createStore } = require('../multilang/store');

function fakeCollection() {
  const docs = new Map();
  let auto = 0;
  const ref = id => ({
    id,
    get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
    set: async d => { docs.set(id, { ...d }); },
    update: async d => { docs.set(id, { ...docs.get(id), ...d }); },
    delete: async () => { docs.delete(id); },
  });
  return {
    doc: id => ref(id ?? `auto${++auto}`),
    where: (field, _op, value) => ({ get: async () => ({ docs: [...docs].filter(([, d]) => d[field] === value).map(([id, d]) => ({ id, ref: ref(id), data: () => d })) }) }),
    size: () => docs.size,
  };
}

const pipelineOutput = lang => ({
  language: lang, level: 'A1-A2', topic: 'A bird flew far.', title: 'Titel', summary: 'Kurz.', body: 'Die [NEW] Regierung plant etwas.',
  translation_ja: '政府は何かを計画しています。', word_count: 5,
  vocabulary: [{ word: 'Regierung', base: 'die Regierung, -en', pos: 'noun', meaning_ja: '政府', example: 'Die Regierung arbeitet.', example_ja: '政府は働きます。' }],
  grammar_note: { point: 'Präsens', explanation_ja: '現在形です。', sentence: 'Die Regierung plant etwas.' },
  quiz: [0, 1, 2, 3].map(i => ({ type: 'comprehension', instruction_ja: '選んでください。', question: `Q${i}`, options: ['a', 'b', 'c', 'd'], answer_index: i, explanation_ja: '説明' })),
  sources: [{ title: 't', source: 's', url: 'u' }], lint_warnings: [], _reviewer_fixes: ['x → y'], _draft: { secret: true },
});

async function startApp({ pro = false, used = 0 } = {}) {
  const mk = () => ({ articles: fakeCollection(), vocabulary: fakeCollection(), mistakes: fakeCollection() });
  const cols = { de: mk(), en: mk() };
  const ids = { de: 0, en: 0 };
  const stores = {};
  const state = { generated: 0, incremented: 0 };
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => { req.userId = req.headers['x-user-id']; next(); });
  app.use('/api', createMiddleware({
    storeFor: lang => (stores[lang] ||= createStore(cols[lang], async () => ++ids[lang])),
    generateArticle: async (userId, lang) => { state.generated++; return pipelineOutput(lang); },
    trial: { check: async () => ({ allowed: pro || used < 3, isPro: pro, generationCount: used }), increment: async () => { state.incremented++; }, limit: 3 },
    // stand-ins for the voice service and the Claude calls
    speech: { sentencesOf: a => a.body.replace(/\[NEW\] /g, '').split(/(?<=\.)\s+/), sentenceAudio: async (text, lang, voice) => Buffer.from(`mp3:${lang}:${voice}:${text}`) },
    practice: {
      MAX_SENTENCE: 300,
      checkSentence: async (lang, level, { sentence }) => ({ verdict: 'almost', corrected: 'Ich sehe den Hund.', translation: '私は犬を見ます。', fixes: sentence.includes('der Hund') ? [{ wrote: 'der Hund', correct: 'den Hund', why: '目的語は4格です。', type: 'case', pattern: 'der → den (akkusativ)' }] : [], words: [{ word: 'Hund', used_correctly: true }], tip: 'いいですね。' }),
      lookupWord: async (lang, word) => ({ word, base: word === 'Regierung' ? 'die Regierung, -en' : `das ${word}`, pos: 'noun', meaning: '意味', note: '', example: 'Beispiel.', example_translation: '例。' }),
    },
  }));
  app.use('/api', (req, res) => res.json({ japanese: true, path: req.path })); // stands in for the existing Japanese routes
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const call = async (method, path, { lang, user = 'user-A', body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'x-user-id': user, 'content-type': 'application/json', ...(lang ? { 'x-learning-language': lang } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  return { call, cols, state, port: () => server.address().port, close: () => server.close() };
}

test('no language header (every app so far) and "ja" go to the Japanese routes untouched', async () => {
  const app = await startApp();
  try {
    for (const lang of [undefined, 'ja']) {
      assert.deepStrictEqual((await app.call('GET', '/articles', { lang })).json, { japanese: true, path: '/articles' });
      assert.strictEqual((await app.call('POST', '/articles/generate', { lang })).json.japanese, true);
      assert.strictEqual((await app.call('GET', '/stats', { lang })).json.japanese, true);
    }
    assert.strictEqual(app.state.generated, 0);
    assert.strictEqual(app.cols.de.articles.size() + app.cols.en.articles.size(), 0);
    assert.strictEqual((await app.call('GET', '/articles', { lang: 'fr' })).status, 400);
  } finally { app.close(); }
});

test('German: generate, list, read, quiz, word list — and nothing leaks to English or another user', async () => {
  const app = await startApp();
  try {
    const made = await app.call('POST', '/articles/generate', { lang: 'de' });
    assert.strictEqual(made.status, 201);
    const a = made.json;
    assert.strictEqual(a.id, 1);
    assert.strictEqual(a.translation, '政府は何かを計画しています。');
    assert.strictEqual(a.explain_language, 'ja');
    assert.deepStrictEqual(a.vocabulary[0], { word: 'Regierung', base: 'die Regierung, -en', pos: 'noun', meaning: '政府', example: 'Die Regierung arbeitet.', example_translation: '政府は働きます。' });
    assert.strictEqual(a.quiz[0].instruction, '選んでください。');
    assert.ok(!('_draft' in a) && !('translation_ja' in a)); // working data is not stored
    assert.strictEqual(app.state.incremented, 1);

    assert.strictEqual((await app.call('GET', '/articles', { lang: 'de' })).json.pagination.total, 1);
    assert.strictEqual((await app.call('GET', '/articles/1', { lang: 'de' })).json.title, 'Titel');
    assert.ok((await app.call('PATCH', '/articles/1', { lang: 'de' })).json.read_at);

    // separation: English and another learner see nothing
    assert.strictEqual((await app.call('GET', '/articles', { lang: 'en' })).json.pagination.total, 0);
    assert.strictEqual((await app.call('GET', '/articles/1', { lang: 'en' })).status, 404);
    assert.strictEqual((await app.call('GET', '/articles/1', { lang: 'de', user: 'user-B' })).status, 404);
    assert.strictEqual((await app.call('DELETE', '/articles/1', { lang: 'de', user: 'user-B' })).status, 404);
    assert.strictEqual((await app.call('GET', '/vocabulary', { lang: 'de', user: 'user-B' })).json.vocabulary.length, 0);

    // quiz: two right, two wrong
    assert.strictEqual((await app.call('GET', '/articles/1/quiz', { lang: 'de' })).json.questions.length, 4);
    const quiz = await app.call('POST', '/articles/1/quiz', { lang: 'de', body: { answers: [0, 1, 0, 0] } });
    assert.deepStrictEqual([quiz.json.correct, quiz.json.total, quiz.json.score], [2, 4, 50]);
    assert.strictEqual((await app.call('GET', '/articles/1', { lang: 'de' })).json.quiz_score, 50);
    assert.strictEqual((await app.call('POST', '/articles/1/quiz', { lang: 'de', body: {} })).status, 400);

    // the same word in a second article is counted, not duplicated
    await app.call('POST', '/articles/generate', { lang: 'de' });
    const words = (await app.call('GET', '/vocabulary', { lang: 'de' })).json.vocabulary;
    assert.strictEqual(words.length, 1);
    assert.strictEqual(words[0].times_seen, 2);

    // deleting an article keeps the word list
    assert.deepStrictEqual((await app.call('DELETE', '/articles/1', { lang: 'de' })).json, { deleted: true });
    assert.strictEqual((await app.call('GET', '/articles', { lang: 'de' })).json.pagination.total, 1);
    assert.strictEqual((await app.call('GET', '/vocabulary', { lang: 'de' })).json.vocabulary.length, 1);
  } finally { app.close(); }
});

test('shared and missing parts: config and device pass through, unbuilt features answer 501, never Japanese data', async () => {
  const app = await startApp();
  try {
    assert.strictEqual((await app.call('GET', '/config', { lang: 'de' })).json.japanese, true);
    assert.strictEqual((await app.call('GET', '/device/status', { lang: 'en' })).json.japanese, true);
    for (const path of ['/stats/quiz-history', '/vocabulary/due', '/something-else']) {
      const r = await app.call('GET', path, { lang: 'de' });
      assert.strictEqual(r.status, 501, path);
      assert.strictEqual(r.json.error, 'NOT_AVAILABLE_FOR_LANGUAGE');
    }
    assert.strictEqual((await app.call('POST', '/articles/generate', { lang: 'en', body: { level: 'C2' } })).status, 400);
  } finally { app.close(); }
});

test('trial: the limit is shared; Pro is not counted', async () => {
  const used = await startApp({ used: 3 });
  try {
    const r = await used.call('POST', '/articles/generate', { lang: 'en' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.json.error, 'TRIAL_EXHAUSTED');
    assert.strictEqual(used.state.generated, 0);
  } finally { used.close(); }
  const pro = await startApp({ pro: true, used: 50 });
  try {
    assert.strictEqual((await pro.call('POST', '/articles/generate', { lang: 'en' })).status, 201);
    assert.strictEqual(pro.state.incremented, 0);
  } finally { pro.close(); }
});

test('word review: schedule, review list, add a looked-up word, statistics', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/articles/generate', { lang: 'de' });
    let words = (await app.call('GET', '/vocabulary', { lang: 'de' })).json;
    assert.deepStrictEqual(words.counts, { new: 1, learning: 0, known: 0, mastered: 0 });
    const w = words.vocabulary[0];
    assert.deepStrictEqual([w.status, w.article, w.headword], ['new', 'die', 'Regierung']);

    // a new word is offered for review
    assert.strictEqual((await app.call('GET', '/vocabulary/review', { lang: 'de' })).json.count, 1);
    // right once → learning; right twice → known, with a date for the next review
    let r = await app.call('POST', `/vocabulary/${w.id}/test`, { lang: 'de', body: { correct: true } });
    assert.deepStrictEqual([r.json.word.status, r.json.statusChanged], ['learning', true]);
    r = await app.call('POST', `/vocabulary/${w.id}/test`, { lang: 'de', body: { correct: true } });
    assert.strictEqual(r.json.word.status, 'known');
    assert.ok(Date.parse(r.json.word.next_review_at) > Date.now());
    // just tested → it rests, the review list is empty
    assert.strictEqual((await app.call('GET', '/vocabulary/review', { lang: 'de' })).json.count, 0);
    // wrong → back to learning
    r = await app.call('POST', `/vocabulary/${w.id}/test`, { lang: 'de', body: { correct: false } });
    assert.deepStrictEqual([r.json.word.status, r.json.word.streak_correct], ['learning', 0]);
    assert.strictEqual((await app.call('POST', `/vocabulary/${w.id}/test`, { lang: 'de', body: {} })).status, 400);
    assert.strictEqual((await app.call('POST', `/vocabulary/${w.id}/test`, { lang: 'de', user: 'user-B', body: { correct: true } })).status, 404);

    // look up a word: one that is already in the list is recognised
    assert.strictEqual((await app.call('POST', '/practice/lookup', { lang: 'de', body: { word: 'Regierung', sentence: 'Die Regierung plant.' } })).json.vocabulary_id, w.id);
    const looked = (await app.call('POST', '/practice/lookup', { lang: 'de', body: { word: 'Gesetz' } })).json;
    assert.strictEqual(looked.vocabulary_id, null);
    assert.strictEqual((await app.call('POST', '/vocabulary', { lang: 'de', body: looked })).status, 201);
    assert.strictEqual((await app.call('POST', '/vocabulary', { lang: 'de', body: looked })).status, 200); // not added twice
    assert.strictEqual((await app.call('GET', '/vocabulary?status=new', { lang: 'de' })).json.vocabulary.length, 1);
    assert.strictEqual((await app.call('GET', '/vocabulary?search=gesetz', { lang: 'de' })).json.vocabulary.length, 1);
    assert.strictEqual((await app.call('PATCH', `/vocabulary/${w.id}`, { lang: 'de', body: { status: 'mastered' } })).json.status, 'mastered');
    assert.strictEqual((await app.call('PATCH', `/vocabulary/${w.id}`, { lang: 'de', body: { status: 'done' } })).status, 400);

    // statistics, per language
    await app.call('PATCH', '/articles/1', { lang: 'de' });
    await app.call('POST', '/articles/1/quiz', { lang: 'de', body: { answers: [0, 1, 2, 0] } });
    const stats = (await app.call('GET', '/stats', { lang: 'de' })).json;
    assert.deepStrictEqual(stats.articles, { total: 1, read: 1, quizzed: 1 });
    assert.deepStrictEqual([stats.vocabulary.total, stats.vocabulary.byStatus.mastered, stats.quiz.averageScore, stats.streak], [2, 1, 75, 1]);
    assert.strictEqual((await app.call('GET', '/stats', { lang: 'en' })).json.articles.total, 0);
    assert.deepStrictEqual((await app.call('DELETE', `/vocabulary/${w.id}`, { lang: 'de' })).json, { deleted: true });
  } finally { app.close(); }
});

test('read aloud and sentence practice', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/articles/generate', { lang: 'de' });
    const sp = (await app.call('GET', '/articles/1/speech', { lang: 'de' })).json;
    assert.deepStrictEqual(sp, { voices: ['female', 'male'], default_voice: 'female', sentences: ['Die Regierung plant etwas.'] });
    const res = await fetch(`http://127.0.0.1:${app.port()}/api/articles/1/speech/0?voice=male`, { headers: { 'x-user-id': 'user-A', 'x-learning-language': 'de' } });
    assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
    assert.strictEqual(await res.text(), 'mp3:de:male:Die Regierung plant etwas.');
    assert.strictEqual((await app.call('GET', '/articles/1/speech/5', { lang: 'de' })).status, 404);

    // a sentence with a mistake is corrected and the mistake is remembered
    const body = { words: [{ word: 'Hund', meaning: '犬' }], sentence: 'Ich sehe der Hund.' };
    const check = (await app.call('POST', '/practice/sentence', { lang: 'de', body })).json;
    assert.strictEqual(check.fixes[0].correct, 'den Hund');
    await app.call('POST', '/practice/sentence', { lang: 'de', body });
    await app.call('POST', '/practice/sentence', { lang: 'de', body: { ...body, first_try: false } }); // a retry is not counted
    const m = (await app.call('GET', '/practice/mistakes', { lang: 'de' })).json;
    assert.strictEqual(m.count, 2);
    assert.deepStrictEqual([m.weak_spots[0].pattern, m.weak_spots[0].count, m.weak_spots[0].type_label], ['der → den (akkusativ)', 2, '格 (Akkusativ / Dativ)']);
    assert.ok(!('user_id' in m.mistakes[0]));
    assert.strictEqual((await app.call('GET', '/practice/mistakes', { lang: 'en' })).json.count, 0);
    assert.strictEqual((await app.call('POST', '/practice/sentence', { lang: 'de', body: { words: [], sentence: 'x' } })).status, 400);
  } finally { app.close(); }
});

test('review schedule and answer parts (pure logic)', () => {
  const { applyTest, pickReviewWords, answerParts } = require('../multilang/learn');
  assert.deepStrictEqual(answerParts('die Regierung, -en'), { article: 'die', headword: 'Regierung' });
  assert.deepStrictEqual(answerParts('rise (rose, risen)'), { article: null, headword: 'rise' });
  assert.deepStrictEqual(answerParts('der/die Jugendliche, -n'), { article: 'der', headword: 'Jugendliche' });
  assert.deepStrictEqual(answerParts('das Cybermobbing (kein Pl.)'), { article: 'das', headword: 'Cybermobbing' });
  // right seven times in a row → mastered
  let w = { status: 'new' };
  for (let i = 0; i < 7; i++) w = { ...w, ...applyTest(w, true) };
  assert.strictEqual(w.status, 'mastered');
  assert.strictEqual({ ...w, ...applyTest(w, false) }.status, 'known');
  // order: due first, then missed, then learning, then new; mastered never
  const now = Date.now(), old = new Date(now - 3 * 864e5).toISOString();
  const picked = pickReviewWords([
    { base: 'new', status: 'new' },
    { base: 'mastered', status: 'mastered', times_tested: 9, streak_correct: 9 },
    { base: 'missed', status: 'learning', times_tested: 2, streak_correct: 0, last_tested_at: old },
    { base: 'due', status: 'known', times_tested: 3, streak_correct: 2, next_review_at: old, last_tested_at: old },
    { base: 'notdue', status: 'known', times_tested: 3, streak_correct: 2, next_review_at: new Date(now + 864e5).toISOString(), last_tested_at: old },
  ], 10, now).map(x => x.base);
  assert.deepStrictEqual(picked, ['due', 'missed', 'new']);
});
