// German / English on the API server.
//
// How a request picks its language: the app sends the header
//   X-Learning-Language: de   (or en)
// No header (every app version up to 1.4) or "ja" means Japanese, and the
// request goes on to the existing Japanese routes exactly as before — this
// file does not read or change anything for it.
//
// For de / en the same URLs are used, served from that language's own
// collections:
//   POST   /api/articles/generate     PATCH  /api/articles/:id   (mark read)
//   GET    /api/articles              DELETE /api/articles/:id
//   GET    /api/articles/:id          GET    /api/articles/:id/quiz
//   GET    /api/vocabulary            POST   /api/articles/:id/quiz
//   GET    /api/articles/:id/speech(/:index)        read aloud
//   GET    /api/vocabulary/review    POST /api/vocabulary/:id/test    word review
//   POST   /api/vocabulary           PATCH / DELETE /api/vocabulary/:id
//   GET    /api/stats
//   POST   /api/practice/sentence    GET /api/practice/mistakes    POST /api/practice/lookup
// /api/config and /api/device are shared (one subscription for all languages).
// Anything else answers 501 — it must never fall through to Japanese data.
//
// TWO ANSWER SHAPES. App 1.5 has its own German / English screens and reads the
// neutral field names (title, body, meaning). From app 1.6 on, German and
// English use the Japanese screens; that app sends "X-Client-Api: 2" and gets
// the same URLs answered in the shape of the Japanese API (./shape.js), plus
//   GET / PUT /api/config    the settings of THIS language (./settings.js)
// Without that header nothing changes for app 1.5.

const express = require('express');
const learn = require('./learn');
const shape = require('./shape');
const wordlevel = require('./wordlevel');
const { toConfig, applyUpdate } = require('./settings');
const { buildProgress } = require('../server/services/progress');
const LANGS = { de: require('./languages/de'), en: require('./languages/en') };

const LANGUAGES = ['de', 'en'];
const LEVELS = ['A1-A2', 'B1', 'B2'];
const SHARED = /^\/(?:config|device)(?:\/|$)/;

/**
 * @param {object} deps
 * @param {(lang: string) => object} deps.storeFor   store of one language (./store.js)
 * @param {(userId, lang, opts) => Promise<object>} deps.generateArticle  runs the pipeline, returns its output
 * @param {{check: Function, increment: Function, limit: number}} deps.trial  shared trial / Pro check
 */
function createMiddleware({ storeFor, generateArticle, trial, settings, progress, speech = require('./speech'), practice = require('./practice') }) {
  const router = express.Router();
  // the learner's stored settings of one language ({} without a settings store, e.g. in old tests)
  // the daily record of the progress screen (nothing is recorded without a progress store, e.g. in old tests)
  const count = async (req, counts) => { if (progress) await progress.bump(req, req.lang, counts); };
  const storedSettings = async req => (settings ? (await settings.load(req.userId, req.lang)) || {} : {});

  router.post('/articles/generate', async (req, res, next) => {
    try {
      const status = await trial.check(req.userId);
      if (!status.allowed) {
        return res.status(403).json({ error: 'TRIAL_EXHAUSTED', message: `You have used your ${trial.limit} free articles. Please upgrade to Pro to continue generating.`, generation_count: status.generationCount, limit: trial.limit });
      }
      const level = req.body && req.body.level;
      if (level && !LEVELS.includes(level)) return res.status(400).json({ error: `Unknown level: ${level}`, levels: LEVELS });
      console.log(`[GENERATE ${req.lang}] user=${req.userId.substring(0, 8)}... level=${level || '(setting)'}`);
      const article = await generateArticle(req.userId, req.lang, { level, topic: req.body && req.body.custom_topic });
      const saved = await storeFor(req.lang).saveArticle(req.userId, article);
      if (!status.isPro) await trial.increment(req.userId); // only after success, like Japanese
      if (!res.writableEnded) res.status(201).json(saved);
    } catch (err) { next(err); }
  });

  router.get('/articles', async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      res.json(await storeFor(req.lang).listArticles(req.userId, page, limit));
    } catch (err) { next(err); }
  });

  const found = (res, value, send = v => res.json(v)) => (value ? send(value) : res.status(404).json({ error: 'Article not found' }));
  // opening an article for the first time counts as a read article of that day
  const markRead = async req => {
    const store = storeFor(req.lang);
    const before = await store.getArticle(req.params.id, req.userId);
    const after = await store.markRead(req.params.id, req.userId);
    if (after && before && !before.read_at) await count(req, { articles: 1 });
    return after;
  };

  router.get('/articles/:id', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).getArticle(req.params.id, req.userId)); } catch (err) { next(err); }
  });
  router.patch('/articles/:id', async (req, res, next) => {
    try { found(res, await markRead(req)); } catch (err) { next(err); }
  });
  router.delete('/articles/:id', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).deleteArticle(req.params.id, req.userId, { deleteVocabulary: req.query.delete_vocabulary === 'true' }), r => res.json({ deleted: true, article_id: Number(req.params.id), deleted_vocabulary: req.query.delete_vocabulary === 'true', vocabulary_deleted_count: r.vocabulary_deleted_count || 0 })); } catch (err) { next(err); }
  });
  router.get('/articles/:id/quiz', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).getArticle(req.params.id, req.userId), a => res.json({ article_id: a.id, questions: a.quiz })); } catch (err) { next(err); }
  });
  router.post('/articles/:id/quiz', async (req, res, next) => {
    try {
      const answers = req.body && req.body.answers;
      if (!Array.isArray(answers)) return res.status(400).json({ error: 'Send {"answers": [0, 2, 1, 3]} — the chosen option per question' });
      const result = await storeFor(req.lang).submitQuiz(req.params.id, req.userId, answers);
      if (result) await count(req, { quizzes: 1 });
      found(res, result);
    } catch (err) { next(err); }
  });
  // ---- read aloud ----
  router.get('/articles/:id/speech', async (req, res, next) => {
    try {
      found(res, await storeFor(req.lang).getArticle(req.params.id, req.userId), a => res.json({ voices: ['female', 'male'], default_voice: 'female', sentences: speech.sentencesOf(a, LANGS[req.lang]) }));
    } catch (err) { next(err); }
  });
  router.get('/articles/:id/speech/:index', async (req, res, next) => {
    try {
      const a = await storeFor(req.lang).getArticle(req.params.id, req.userId);
      if (!a) return res.status(404).json({ error: 'Article not found' });
      const sentences = speech.sentencesOf(a, LANGS[req.lang]);
      const i = parseInt(req.params.index, 10);
      if (!(i >= 0 && i < sentences.length)) return res.status(404).json({ error: 'No such sentence' });
      const audio = await speech.sentenceAudio(sentences[i], req.lang, String(req.query.voice || ''));
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' });
      res.send(audio);
    } catch (err) { next(err); }
  });

  // ---- word list and review ----
  router.get('/vocabulary', async (req, res, next) => {
    try {
      let words = await storeFor(req.lang).listVocabulary(req.userId);
      const counts = { new: 0, learning: 0, known: 0, mastered: 0 };
      for (const w of words) counts[w.status] = (counts[w.status] || 0) + 1;
      const total = words.length;
      if (req.query.status) words = words.filter(w => w.status === req.query.status);
      const q = String(req.query.search || '').toLowerCase();
      if (q) words = words.filter(w => String(w.base).toLowerCase().includes(q) || String(w.meaning).includes(q));
      res.json({ vocabulary: words, total, counts });
    } catch (err) { next(err); }
  });
  router.get('/vocabulary/review', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 10, 30);
      const words = learn.pickReviewWords(await storeFor(req.lang).listVocabulary(req.userId), limit);
      res.json({ words, count: words.length });
    } catch (err) { next(err); }
  });
  router.post('/vocabulary', async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.base || !b.meaning) return res.status(400).json({ error: 'Must provide "base" and "meaning"' });
      const word = await storeFor(req.lang).addWord(req.userId, { word: String(b.word || b.base).slice(0, 80), base: String(b.base).slice(0, 120), pos: String(b.pos || '').slice(0, 20), meaning: String(b.meaning).slice(0, 200), example: String(b.example || '').slice(0, 300), example_translation: String(b.example_translation || '').slice(0, 300), article_id: b.article_id || null });
      res.status(word.existed ? 200 : 201).json(word);
    } catch (err) { next(err); }
  });
  const foundWord = (res, value, send = v => res.json(v)) => (value ? send(value) : res.status(404).json({ error: 'Word not found' }));
  router.post('/vocabulary/:id/test', async (req, res, next) => {
    try {
      if (typeof (req.body || {}).correct !== 'boolean') return res.status(400).json({ error: 'Must provide "correct" (boolean)' });
      const r = await storeFor(req.lang).testWord(req.params.id, req.userId, req.body.correct);
      // app 1.5: every review answer is typed
      if (r) await count(req, { answers: 1, typed: req.body.correct ? 1 : 0, known: r.becameKnown ? 1 : 0 });
      foundWord(res, r);
    } catch (err) { next(err); }
  });
  router.patch('/vocabulary/:id', async (req, res, next) => {
    try {
      const status = (req.body || {}).status;
      if (!['new', 'learning', 'known', 'mastered'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
      foundWord(res, await storeFor(req.lang).setWordStatus(req.params.id, req.userId, status));
    } catch (err) { next(err); }
  });
  router.delete('/vocabulary/:id', async (req, res, next) => {
    try { foundWord(res, await storeFor(req.lang).deleteWord(req.params.id, req.userId), () => res.json({ deleted: true })); } catch (err) { next(err); }
  });

  // ---- statistics ----
  router.get('/stats', async (req, res, next) => {
    try {
      const store = storeFor(req.lang);
      const [articles, words] = await Promise.all([store.listAllArticles(req.userId), store.listVocabulary(req.userId)]);
      res.json(learn.stats(articles, words));
    } catch (err) { next(err); }
  });

  // ---- sentence practice, mistakes, word lookup ----
  router.post('/practice/sentence', async (req, res, next) => {
    try {
      const { words, sentence, context, focus, first_try: firstTry, level } = req.body || {};
      if (typeof sentence !== 'string' || !sentence.trim()) return res.status(400).json({ error: 'Must provide "sentence"' });
      if (sentence.length > practice.MAX_SENTENCE) return res.status(400).json({ error: `Sentence too long (max ${practice.MAX_SENTENCE} characters)` });
      if (!Array.isArray(words) || words.length === 0 || words.length > 3) return res.status(400).json({ error: 'Must provide 1–3 "words"' });
      const result = await practice.checkSentence(LANGS[req.lang], LEVELS.includes(level) ? level : toConfig(LANGS[req.lang], await storedSettings(req)).proficiency_level, { words, sentence, context, focus });
      // only the first try counts, like Japanese (a retry would count the same slip twice)
      if (firstTry !== false) await storeFor(req.lang).saveMistakes(req.userId, { fixes: result.fixes, sentence: sentence.trim(), corrected: result.corrected });
      if (firstTry !== false) await count(req, { sentences: 1 });
      res.json({ ...result, english: result.translation }); // "english": the name the shared screen reads
    } catch (err) { next(err); }
  });
  router.get('/practice/mistakes', async (req, res, next) => {
    try {
      const mistakes = await storeFor(req.lang).listMistakes(req.userId);
      res.json({ weak_spots: learn.weakSpots(mistakes, req.lang), mistakes: mistakes.slice(0, 50), count: mistakes.length });
    } catch (err) { next(err); }
  });
  router.post('/practice/lookup', async (req, res, next) => {
    try {
      const word = String((req.body || {}).word || '').trim().slice(0, 60);
      if (!word) return res.status(400).json({ error: 'Must provide "word"' });
      const entry = await practice.lookupWord(LANGS[req.lang], word, String((req.body || {}).sentence || '').trim().slice(0, 400));
      const mine = (await storeFor(req.lang).listVocabulary(req.userId)).find(w => String(w.base).toLowerCase() === entry.base.toLowerCase());
      res.json({ ...entry, vocabulary_id: mine ? mine.id : null });
    } catch (err) { next(err); }
  });

  // ================= app 1.6+: the same URLs in the shape of the Japanese API =================
  const v2 = express.Router();
  const lookupFor = req => wordlevel.load(LANGS[req.lang]);
  const numbered = req => storeFor(req.lang).listVocabularyNumbered(req.userId);

  v2.get('/config', async (req, res, next) => {
    try { res.json(toConfig(LANGS[req.lang], await storedSettings(req))); } catch (err) { next(err); }
  });
  v2.put('/config', async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Must provide an object of key-value pairs' });
      const { stored, errors } = applyUpdate(LANGS[req.lang], await storedSettings(req), req.body);
      if (errors.length) return res.status(400).json({ errors });
      if (settings) await settings.save(req.userId, req.lang, stored);
      res.json(toConfig(LANGS[req.lang], stored));
    } catch (err) { next(err); }
  });

  v2.post('/articles/generate', async (req, res, next) => {
    try {
      const status = await trial.check(req.userId);
      if (!status.allowed) {
        return res.status(403).json({ error: 'TRIAL_EXHAUSTED', message: `You have used your ${trial.limit} free articles. Please upgrade to Pro to continue generating.`, generation_count: status.generationCount, limit: trial.limit });
      }
      const b = req.body || {};
      if (b.proficiency_level && !LEVELS.includes(b.proficiency_level)) return res.status(400).json({ error: `Unknown level: ${b.proficiency_level}`, levels: LEVELS });
      console.log(`[GENERATE ${req.lang}] user=${req.userId.substring(0, 8)}... level=${b.proficiency_level || '(setting)'} new=${b.new_words_per_article ?? '(setting)'} length=${b.target_word_count ?? '(setting)'}`);
      const article = await generateArticle(req.userId, req.lang, { request: b, topic: b.custom_topic });
      const saved = await storeFor(req.lang).saveArticle(req.userId, article);
      if (!status.isPro) await trial.increment(req.userId);
      if (!res.writableEnded) res.status(201).json(shape.article(saved, await numbered(req), lookupFor(req)));
    } catch (err) { next(err); }
  });
  v2.get('/articles', async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const list = await storeFor(req.lang).listArticles(req.userId, page, limit);
      res.json({ articles: list.articles.map(shape.articleItem), pagination: list.pagination });
    } catch (err) { next(err); }
  });
  v2.get('/articles/:id', async (req, res, next) => {
    try {
      const a = await storeFor(req.lang).getArticle(req.params.id, req.userId);
      if (!a) return res.status(404).json({ error: 'Article not found' });
      res.json(shape.article(a, await numbered(req), lookupFor(req)));
    } catch (err) { next(err); }
  });
  v2.patch('/articles/:id', async (req, res, next) => {
    try { found(res, await markRead(req), () => res.json({ updated: true })); } catch (err) { next(err); }
  });
  v2.get('/articles/:id/quiz', async (req, res, next) => {
    try {
      found(res, await storeFor(req.lang).getArticle(req.params.id, req.userId), a => {
        const questions = shape.quizQuestions(a);
        res.json({ article_id: a.id, article_title: a.title, questions, total: questions.length, answered: 0, correct: 0 });
      });
    } catch (err) { next(err); }
  });
  v2.post('/articles/:id/quiz', async (req, res, next) => {
    try {
      const answers = req.body && req.body.answers;
      if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ error: 'Must provide "answers" array with { question_id, answer }' });
      const store = storeFor(req.lang);
      const a = await store.getArticle(req.params.id, req.userId);
      if (!a) return res.status(404).json({ error: 'Article not found' });
      const r = await store.submitQuiz(req.params.id, req.userId, shape.quizAnswers(a, answers));
      await count(req, { quizzes: 1 });
      const given = new Map(answers.map(x => [x.question_id, x.answer]));
      res.json({
        results: r.results.map((x, i) => ({ question_id: i + 1, correct: x.correct, your_answer: given.get(i + 1) ?? '', correct_answer: a.quiz[i].options[a.quiz[i].answer_index], hint: x.correct ? null : x.explanation })),
        score: { correct: r.correct, total: r.total, percentage: r.score },
      });
    } catch (err) { next(err); }
  });

  v2.get('/vocabulary', async (req, res, next) => {
    try {
      let words = await numbered(req);
      if (req.query.status) words = words.filter(w => w.status === req.query.status);
      const q = String(req.query.search || '').toLowerCase();
      if (q) words = words.filter(w => String(w.base).toLowerCase().includes(q) || String(w.meaning).includes(q));
      const total = words.length;
      const limit = Math.min(parseInt(req.query.limit) || 200, 500);
      const offset = parseInt(req.query.offset) || 0;
      const lookup = lookupFor(req);
      res.json({ vocabulary: words.slice(offset, offset + limit).map(w => shape.word(w, lookup)), total });
    } catch (err) { next(err); }
  });
  v2.get('/vocabulary/review', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 10, 30);
      const all = await numbered(req);
      const words = learn.pickReviewWords(all, limit);
      const lookup = lookupFor(req);
      res.json({ words: words.map(w => shape.word(w, lookup)), count: words.length, also_accept: shape.alsoAccept(words, all) });
    } catch (err) { next(err); }
  });
  v2.post('/vocabulary', async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.word_romaji_macron || !b.meaning_en) return res.status(400).json({ error: 'Must provide "word_romaji_macron" and "meaning_en"' });
      // the example comes with the lookup ("sentence\ntranslation"); the tapped sentence is the fallback
      const [example, exampleJa] = String(b.example || b.context_sentence || '').split('\n');
      const word = await storeFor(req.lang).addWord(req.userId, { word: String(b.word || b.word_romaji_macron).slice(0, 80), base: String(b.word_romaji_macron).slice(0, 120), pos: String(b.part_of_speech || '').slice(0, 20), meaning: String(b.meaning_en).slice(0, 200), example: String(example || '').slice(0, 300), example_translation: String(exampleJa || '').slice(0, 300), article_id: b.article_id || null });
      res.status(word.existed ? 200 : 201).json(shape.word(word, lookupFor(req)));
    } catch (err) { next(err); }
  });
  // a word is addressed by its number; find the stored document first
  const withWord = handler => async (req, res, next) => {
    try {
      const store = storeFor(req.lang);
      const id = await store.wordIdByNumber(req.params.id, req.userId);
      if (!id) return res.status(404).json({ error: 'Word not found' });
      await handler(req, res, store, id);
    } catch (err) { next(err); }
  };
  v2.post('/vocabulary/:id/test', withWord(async (req, res, store, id) => {
    if (typeof (req.body || {}).correct !== 'boolean') return res.status(400).json({ error: 'Must provide "correct" (boolean)' });
    const mode = ['typed', 'sentence'].includes(req.body.mode) ? req.body.mode : 'choice';
    const r = await store.testWord(id, req.userId, req.body.correct, mode);
    await count(req, { answers: mode === 'typed' ? 1 : 0, typed: mode === 'typed' && req.body.correct ? 1 : 0, quizzes: mode === 'choice' ? 1 : 0, known: r.becameKnown ? 1 : 0 });
    res.json({ word: shape.word(r.word, lookupFor(req)), statusChanged: r.statusChanged });
  }));
  v2.patch('/vocabulary/:id', withWord(async (req, res, store, id) => {
    const status = (req.body || {}).status;
    if (!['new', 'learning', 'known', 'mastered'].includes(status)) return res.status(400).json({ error: 'Invalid status. Must be one of: new, learning, known, mastered' });
    res.json(shape.word(await store.setWordStatus(id, req.userId, status), lookupFor(req)));
  }));
  v2.delete('/vocabulary/:id', withWord(async (req, res, store, id) => {
    await store.deleteWord(id, req.userId);
    res.json({ deleted: true });
  }));

  v2.get('/stats', async (req, res, next) => {
    try {
      const store = storeFor(req.lang);
      const [articles, words] = await Promise.all([store.listAllArticles(req.userId), store.listVocabulary(req.userId)]);
      res.json(shape.stats(learn.stats(articles, words), words, lookupFor(req)));
    } catch (err) { next(err); }
  });

  // the progress screen: the same rules as Japanese (server/services/progress.js, PROGRESS_SCREEN.md)
  v2.get('/progress', async (req, res, next) => {
    try {
      const store = storeFor(req.lang);
      const lookup = lookupFor(req);
      const [articles, words, mistakes, stored, record] = await Promise.all([
        store.listAllArticles(req.userId), store.listVocabulary(req.userId), store.listMistakes(req.userId),
        storedSettings(req), progress ? progress.load(req.userId, req.lang) : {},
      ]);
      const result = buildProgress({
        lang: req.lang, level: toConfig(LANGS[req.lang], stored).proficiency_level,
        // a word tested by app 1.5 has no recall counters; there every test was typed
        words: words.map(w => ({ ...w, level: shape.wordLevel(lookup, w.base), times_recalled: w.times_recalled ?? w.times_tested, times_recalled_correct: w.times_recalled_correct ?? w.times_tested_correct })),
        articles,
        mistakes: mistakes.map(m => ({ key: `${m.type}|${m.pattern}`, label: m.pattern, type_label: (learn.MISTAKE_TYPES[req.lang] || {})[m.type] || 'その他', created_at: m.created_at, wrote: m.wrote, correct: m.correct, why: m.why })),
        record: record || {}, tzOffsetMin: progress ? progress.tz(req) : 0,
      });
      const { save, ...body } = result;
      if (save && progress) await progress.save(req.userId, req.lang, save);
      res.json(body);
    } catch (err) { next(err); }
  });

  v2.post('/practice/lookup', async (req, res, next) => {
    try {
      const tapped = String((req.body || {}).word || '').trim().slice(0, 60);
      if (!tapped) return res.status(400).json({ error: 'Must provide "word"' });
      const entry = await practice.lookupWord(LANGS[req.lang], tapped, String((req.body || {}).sentence || '').trim().slice(0, 400));
      const mine = (await numbered(req)).find(w => String(w.base).toLowerCase() === entry.base.toLowerCase());
      res.json({
        word_romaji_macron: entry.base, word_kanji: null, word_kana: null, meaning_en: entry.meaning,
        part_of_speech: entry.pos || null, note: entry.note || '', jlpt_level: shape.wordLevel(lookupFor(req), entry.base),
        vocabulary_id: mine ? mine.num_id : null,
        word: tapped, example: [entry.example, entry.example_translation].filter(Boolean).join('\n'),
      });
    } catch (err) { next(err); }
  });

  // read aloud, sentence check, mistakes, deleting an article: one shape for both
  v2.use(router);

  // Mounted on /api, after the user-id middleware.
  return function learningLanguage(req, res, next) {
    const lang = String(req.headers['x-learning-language'] || 'ja').toLowerCase();
    if (lang === 'ja') return next(); // Japanese: untouched
    if (!LANGUAGES.includes(lang)) return res.status(400).json({ error: `Unknown learning language: ${lang}`, languages: ['ja', ...LANGUAGES] });
    req.lang = lang;
    const shared = Number(req.headers['x-client-api']) >= 2 ? /^\/device(?:\/|$)/ : SHARED; // 1.6+: settings are per language
    if (shared.test(req.path)) return next();
    (shared === SHARED ? router : v2)(req, res, err => {
      if (err) return next(err);
      res.status(501).json({ error: 'NOT_AVAILABLE_FOR_LANGUAGE', message: `${req.method} ${req.path} is not available for "${lang}" yet.` });
    });
  };
}

module.exports = { createMiddleware, LANGUAGES, LEVELS };
