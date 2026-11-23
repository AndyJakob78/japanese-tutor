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
  const state = { generated: 0, incremented: 0, settings: {}, requests: [], progress: {} };
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => { req.userId = req.headers['x-user-id']; next(); });
  app.use('/api', createMiddleware({
    storeFor: lang => (stores[lang] ||= createStore(cols[lang], async () => ++ids[lang])),
    generateArticle: async (userId, lang, opts) => {
      state.generated++; state.requests.push(opts);
      if (!opts.quizLater) return pipelineOutput(lang);
      // quiz made after the article: resolves when the test calls state.finishQuiz()
      const later = new Promise(r => { state.finishQuiz = () => r({ questions: pipelineOutput(lang).quiz, problems: [] }); });
      return { ...pipelineOutput(lang), quiz: [], _makeQuiz: () => later };
    },
    progress: {
      bump: async (req, lang, counts) => { const k = `${req.userId}|${lang}`; const d = (state.progress[k] ||= { days: { today: {} } }).days.today; for (const [kind, n] of Object.entries(counts)) if (n) d[kind] = (d[kind] || 0) + n; },
      load: async (userId, lang) => { const r = state.progress[`${userId}|${lang}`]; return r ? { days: { [new Date().toISOString().slice(0, 10)]: r.days.today }, ...r.extra } : {}; },
      save: async (userId, lang, patch) => { (state.progress[`${userId}|${lang}`] ||= { days: { today: {} } }).extra = patch; },
      tz: () => 0,
    },
    settings: { load: async (userId, lang) => state.settings[`${userId}|${lang}`] || {}, save: async (userId, lang, stored) => { state.settings[`${userId}|${lang}`] = stored; } },
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
  const call = async (method, path, { lang, user = 'user-A', body, api, headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'x-user-id': user, 'content-type': 'application/json', ...(lang ? { 'x-learning-language': lang } : {}), ...(api ? { 'x-client-api': String(api) } : {}), ...headers },
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
    assert.strictEqual((await app.call('DELETE', '/articles/1', { lang: 'de' })).json.deleted, true);
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


// ---------- app 1.6+: German / English answered in the shape of the Japanese API ----------
const v2 = { lang: 'de', api: 2 };

test('1.6 shape: article, list, quiz and word list read like the Japanese API', async () => {
  const app = await startApp();
  try {
    const made = await app.call('POST', '/articles/generate', { ...v2, body: { proficiency_level: 'B1', new_words_per_article: 5, target_word_count: 150, custom_topic: 'sport' } });
    assert.strictEqual(made.status, 201);
    assert.deepStrictEqual(app.state.requests[0], { request: { proficiency_level: 'B1', new_words_per_article: 5, target_word_count: 150, custom_topic: 'sport' }, topic: 'sport' });
    const a = made.json;
    assert.strictEqual(a.title_romaji, 'Titel');
    assert.strictEqual(a.body_romaji, 'Die [NEW] Regierung plant etwas.');
    assert.strictEqual(a.translation_en, '政府は何かを計画しています。');
    assert.strictEqual(a.writing_system, 'romaji');
    assert.deepStrictEqual(a.grammar_points, [{ pattern: 'Präsens', level: 'A1-A2', explanation: '現在形です。', examples: ['Die Regierung plant etwas.'] }]);
    assert.deepStrictEqual(a.sources, [{ name: 's', url: 'u' }]);
    const w = a.vocabulary[0];
    assert.strictEqual(w.id, 1);                                   // a whole number, like Japanese word ids
    assert.strictEqual(w.word_romaji_macron, 'die Regierung, -en'); // dictionary form
    assert.strictEqual(w.word_romaji, 'Regierung');                 // as written in the text
    assert.strictEqual(w.meaning_en, '政府');
    assert.strictEqual(w.is_new, 1);
    assert.strictEqual(w.status, 'new');
    assert.strictEqual(a._draft, undefined);

    const list = (await app.call('GET', '/articles', v2)).json;
    assert.strictEqual(list.articles[0].title_romaji, 'Titel');
    assert.strictEqual(list.pagination.total, 1);
    assert.deepStrictEqual((await app.call('PATCH', '/articles/1', { ...v2, body: { read_at: true } })).json, { updated: true });

    const quiz = (await app.call('GET', '/articles/1/quiz', v2)).json;
    assert.strictEqual(quiz.article_title, 'Titel');
    assert.strictEqual(quiz.questions.length, 4);
    assert.deepStrictEqual({ id: quiz.questions[1].id, q: quiz.questions[1].question_romaji, en: quiz.questions[1].question_en, right: quiz.questions[1].correct_answer, wrong: quiz.questions[1].distractors },
      { id: 2, q: 'Q1', en: '選んでください。', right: 'b', wrong: ['a', 'c', 'd'] });
    const result = (await app.call('POST', '/articles/1/quiz', { ...v2, body: { answers: [{ question_id: 1, answer: 'a' }, { question_id: 2, answer: 'B' }, { question_id: 3, answer: 'a' }, { question_id: 4, answer: 'd' }] } })).json;
    assert.deepStrictEqual(result.score, { correct: 3, total: 4, percentage: 75 });
    assert.deepStrictEqual(result.results[2], { question_id: 3, correct: false, your_answer: 'a', correct_answer: 'c', hint: '説明' });
    assert.strictEqual((await app.call('GET', '/articles/1', v2)).json.quiz_score, 0.75);   // the Japanese screens read 0-1

    const words = (await app.call('GET', '/vocabulary?limit=50&offset=0', v2)).json;
    assert.strictEqual(words.total, 1);
    assert.strictEqual(words.vocabulary[0].word_romaji_macron, 'die Regierung, -en');
    assert.strictEqual((await app.call('GET', '/vocabulary?status=known', v2)).json.total, 0);

    // app 1.5 (no X-Client-Api) still gets its own shape from the same data
    const old = (await app.call('GET', '/articles/1', { lang: 'de' })).json;
    assert.strictEqual(old.title, 'Titel');
    assert.strictEqual(old.title_romaji, undefined);
    assert.strictEqual((await app.call('GET', '/config', { lang: 'de' })).json.japanese, true);
    // and Japanese is untouched whatever the app version
    assert.strictEqual((await app.call('GET', '/articles', { lang: 'ja', api: 2 })).json.japanese, true);
    assert.strictEqual((await app.call('GET', '/config', { api: 2 })).json.japanese, true);
    assert.strictEqual((await app.call('GET', '/device/status', v2)).json.japanese, true);
  } finally { app.close(); }
});

test('1.6 shape: tests by word number — only typed answers and own sentences make a word known', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/articles/generate', v2);
    const review = (await app.call('GET', '/vocabulary/review?limit=10', v2)).json;
    assert.strictEqual(review.words[0].id, 1);
    assert.deepStrictEqual(review.also_accept, {});
    // multiple choice: counted, never promotes
    for (let i = 0; i < 3; i++) await app.call('POST', '/vocabulary/1/test', { ...v2, body: { correct: true, mode: 'choice' } });
    let w = (await app.call('GET', '/vocabulary', v2)).json.vocabulary[0];
    assert.deepStrictEqual([w.status, w.times_tested, w.streak_correct], ['learning', 3, 3]);
    // typed: recall on one day is not enough yet (two different days are needed)
    const typed = (await app.call('POST', '/vocabulary/1/test', { ...v2, body: { correct: true, mode: 'typed' } })).json;
    assert.strictEqual(typed.word.status, 'learning');
    assert.strictEqual(typeof typed.statusChanged, 'boolean');
    const stats = (await app.call('GET', '/stats', v2)).json;
    assert.deepStrictEqual(stats.vocabulary.recall, { tested: 1, correct: 1, percent: 100 });
    assert.deepStrictEqual(stats.vocabulary.choice, { tested: 3, correct: 3, percent: 100 });
    assert.ok(Array.isArray(stats.vocabulary.byLevel));
    assert.strictEqual(stats.vocabulary.byStatus.learning, 1);

    assert.strictEqual((await app.call('PATCH', '/vocabulary/1', { ...v2, body: { status: 'known' } })).json.status, 'known');
    assert.strictEqual((await app.call('POST', '/vocabulary/99/test', { ...v2, body: { correct: true } })).status, 404);
    assert.strictEqual((await app.call('POST', '/vocabulary/1/test', { ...v2, user: 'user-B', body: { correct: true } })).status, 404);

    // a tapped word: looked up, added, numbered after the existing ones
    const look = (await app.call('POST', '/practice/lookup', { ...v2, body: { word: 'Haus', sentence: 'Das Haus ist alt.' } })).json;
    assert.deepStrictEqual([look.word_romaji_macron, look.meaning_en, look.vocabulary_id, look.part_of_speech], ['das Haus', '意味', null, 'noun']);
    const added = await app.call('POST', '/vocabulary', { ...v2, body: { word_romaji_macron: look.word_romaji_macron, meaning_en: look.meaning_en, part_of_speech: 'noun', article_id: 1, context_sentence: 'Das Haus ist alt.' } });
    assert.deepStrictEqual([added.status, added.json.id, added.json.context_sentence], [201, 2, 'Das Haus ist alt.']);
    assert.strictEqual((await app.call('POST', '/practice/lookup', { ...v2, body: { word: 'Haus' } })).json.vocabulary_id, 2);

    // the sentence check answers with "english" too (the name the shared screen reads)
    const check = (await app.call('POST', '/practice/sentence', { ...v2, body: { words: [{ word: 'der Hund', meaning: '犬' }], sentence: 'Ich sehe der Hund.' } })).json;
    assert.strictEqual(check.english, '私は犬を見ます。');
    assert.strictEqual((await app.call('GET', '/practice/mistakes', v2)).json.weak_spots[0].pattern, 'der → den (akkusativ)');

    // deleting an article with its words removes only the words first met there
    const gone = (await app.call('DELETE', '/articles/1?delete_vocabulary=true', v2)).json;
    assert.deepStrictEqual([gone.deleted, gone.vocabulary_deleted_count], [true, 2]);
    assert.strictEqual((await app.call('GET', '/vocabulary', v2)).json.total, 0);
  } finally { app.close(); }
});

test('1.6 settings: one set per language, level-bound values follow the level until changed', async () => {
  const app = await startApp();
  try {
    const first = (await app.call('GET', '/config', v2)).json;
    assert.deepStrictEqual([first.proficiency_level, first.target_word_count, first.max_sentence_length, first.new_words_per_article, first.quiz_questions_count, first.writing_system],
      ['A1-A2', 100, 14, 8, 6, 'romaji']);
    assert.strictEqual(first.topics.length, 5);
    // "Save" sends every value; only the level was changed → length and sentence length move with it
    const b2 = (await app.call('PUT', '/config', { ...v2, body: { ...first, proficiency_level: 'B2' } })).json;
    assert.deepStrictEqual([b2.proficiency_level, b2.target_word_count, b2.max_sentence_length, b2.new_words_per_article], ['B2', 250, 30, 10]);
    // an own value stays when the level changes again
    const own = (await app.call('PUT', '/config', { ...v2, body: { ...b2, new_words_per_article: 0, topics: ['Sport', 'sport', ' Musik '], regions: ['Bayern'] } })).json;
    assert.deepStrictEqual([own.new_words_per_article, own.topics, own.regions], [0, ['sport', 'musik'], ['bayern']]);
    const b1 = (await app.call('PUT', '/config', { ...v2, body: { ...own, proficiency_level: 'B1' } })).json;
    assert.deepStrictEqual([b1.proficiency_level, b1.new_words_per_article, b1.target_word_count], ['B1', 0, 150]);
    // English keeps its own settings; another user too
    assert.strictEqual((await app.call('GET', '/config', { lang: 'en', api: 2 })).json.proficiency_level, 'A1-A2');
    assert.strictEqual((await app.call('GET', '/config', { ...v2, user: 'user-B' })).json.proficiency_level, 'A1-A2');
    assert.strictEqual((await app.call('PUT', '/config', { ...v2, body: { proficiency_level: 'N3' } })).status, 400);
  } finally { app.close(); }
});

test('1.6 settings: what one article is written with (pure)', () => {
  const { effective } = require('../multilang/settings');
  const { withRules } = require('../multilang/generate');
  const de = require('../multilang/languages/de');
  // nothing set: exactly the level's own numbers — the prompts are the ones that were tested
  const plain = effective(de, {});
  assert.deepStrictEqual(plain, { level: 'A1-A2', topics: plain.topics, regions: [], days: 10, rules: { words: 110, maxWords: 14, newWords: [4, 8], quizCount: 6, reviewCount: 3 } });
  assert.strictEqual(withRules(de, 'A1-A2', plain.rules).levels['A1-A2'].rules, de.levels['A1-A2'].rules);
  // the form passes the shown settings on: that is not a wish
  assert.deepStrictEqual(effective(de, {}, { proficiency_level: 'B1', new_words_per_article: 8, target_word_count: 100 }).rules, { words: 170, maxWords: 22, newWords: [5, 9], quizCount: 6, reviewCount: 3 });
  // a real wish in the form, and zero new words
  const wish = effective(de, { max_sentence_length: 10, reuse_ratio: 0.9, news_timeframe_hours: 36, quiz_questions_count: 9 }, { new_words_per_article: 0, target_word_count: 300 });
  assert.deepStrictEqual([wish.days, wish.rules], [2, { words: 300, maxWords: 10, newWords: [0, 0], quizCount: 9, reviewCount: 9 }]);
  assert.match(withRules(de, 'A1-A2', wish.rules).levels['A1-A2'].rules, /NO sentence longer than 10 words/);
  assert.deepStrictEqual(effective(de, { new_words_per_article: 12 }).rules.newWords, [9, 12]);
});


test('1.6 progress: activity is recorded per language and day, and the screen data comes back', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/articles/generate', v2);
    const empty = (await app.call('GET', '/progress', v2)).json;
    assert.deepStrictEqual([empty.level, empty.next_level, empty.progress.total, empty.streak.current], ['A1-A2', 'B1', 1300, 0]);
    assert.deepStrictEqual([empty.next_action.kind, empty.next_action.article_id], ['read', 1]);   // an unread article is waiting
    assert.strictEqual(empty.save, undefined);                                                     // internal, never sent

    await app.call('PATCH', '/articles/1', { ...v2, body: { read_at: true } });
    await app.call('PATCH', '/articles/1', { ...v2, body: { read_at: true } });                    // opening it again does not count twice
    await app.call('POST', '/vocabulary/1/test', { ...v2, body: { correct: true, mode: 'typed' } });
    await app.call('POST', '/vocabulary/1/test', { ...v2, body: { correct: false, mode: 'typed' } });
    await app.call('POST', '/vocabulary/1/test', { ...v2, body: { correct: true, mode: 'choice' } });
    await app.call('POST', '/practice/sentence', { ...v2, body: { words: [{ word: 'Hund', meaning: '犬' }], sentence: 'Ich sehe den Hund.' } });
    await app.call('POST', '/practice/sentence', { ...v2, body: { words: [{ word: 'Hund', meaning: '犬' }], sentence: 'Ich sehe den Hund.', first_try: false } });
    assert.deepStrictEqual(app.state.progress['user-A|de'].days.today, { articles: 1, answers: 2, typed: 1, quizzes: 1, sentences: 1 });
    assert.strictEqual(app.state.progress['user-A|en'], undefined);

    const p = (await app.call('GET', '/progress', v2)).json;
    assert.deepStrictEqual([p.streak.current, p.streak.active_today], [1, true]);
    assert.deepStrictEqual(p.goals.map(g => [g.key, g.done]), [['articles', 1], ['typed', 1], ['sentences', 1]]);
    assert.strictEqual(p.next_action.kind, 'quiz');                                                // read, quiz not taken
    // app 1.5 (own screens) records too, and has no progress screen
    await app.call('POST', '/vocabulary/' + (await app.call('GET', '/vocabulary', { lang: 'de' })).json.vocabulary[0].id + '/test', { lang: 'de', body: { correct: true } });
    assert.strictEqual(app.state.progress['user-A|de'].days.today.typed, 2);
    assert.strictEqual((await app.call('GET', '/progress', { lang: 'de' })).status, 501);
    assert.strictEqual((await app.call('GET', '/progress', {})).json.japanese, true);
  } finally { app.close(); }
});


test('1.7 quiz later: the article comes first, the quiz shows "pending" until it is saved', async () => {
  const app = await startApp();
  try {
    const made = await app.call('POST', '/articles/generate', { ...v2, headers: { 'x-quiz-later': '1' }, body: {} });
    assert.strictEqual(made.status, 201);
    assert.strictEqual(app.state.requests[0].quizLater, true);
    let quiz = (await app.call('GET', '/articles/1/quiz', v2)).json;
    assert.strictEqual(quiz.status, 'pending');
    assert.strictEqual(quiz.questions.length, 0);
    app.state.finishQuiz();
    await new Promise(r => setTimeout(r, 30));
    quiz = (await app.call('GET', '/articles/1/quiz', v2)).json;
    assert.strictEqual(quiz.status, 'ready');
    assert.strictEqual(quiz.questions.length, 4);
    // without the header (older apps) the quiz comes with the article, as before
    await app.call('POST', '/articles/generate', { ...v2, body: {} });
    assert.strictEqual(app.state.requests[1].quizLater, undefined);
    assert.strictEqual((await app.call('GET', '/articles/2/quiz', v2)).json.questions.length, 4);
  } finally { app.close(); }
});
