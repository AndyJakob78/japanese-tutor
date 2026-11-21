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

const express = require('express');
const learn = require('./learn');
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
function createMiddleware({ storeFor, generateArticle, trial, speech = require('./speech'), practice = require('./practice') }) {
  const router = express.Router();

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

  router.get('/articles/:id', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).getArticle(req.params.id, req.userId)); } catch (err) { next(err); }
  });
  router.patch('/articles/:id', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).markRead(req.params.id, req.userId)); } catch (err) { next(err); }
  });
  router.delete('/articles/:id', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).deleteArticle(req.params.id, req.userId), () => res.json({ deleted: true })); } catch (err) { next(err); }
  });
  router.get('/articles/:id/quiz', async (req, res, next) => {
    try { found(res, await storeFor(req.lang).getArticle(req.params.id, req.userId), a => res.json({ article_id: a.id, questions: a.quiz })); } catch (err) { next(err); }
  });
  router.post('/articles/:id/quiz', async (req, res, next) => {
    try {
      const answers = req.body && req.body.answers;
      if (!Array.isArray(answers)) return res.status(400).json({ error: 'Send {"answers": [0, 2, 1, 3]} — the chosen option per question' });
      found(res, await storeFor(req.lang).submitQuiz(req.params.id, req.userId, answers));
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
      foundWord(res, await storeFor(req.lang).testWord(req.params.id, req.userId, req.body.correct));
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
      const result = await practice.checkSentence(LANGS[req.lang], LEVELS.includes(level) ? level : 'A1-A2', { words, sentence, context, focus });
      // only the first try counts, like Japanese (a retry would count the same slip twice)
      if (firstTry !== false) await storeFor(req.lang).saveMistakes(req.userId, { fixes: result.fixes, sentence: sentence.trim(), corrected: result.corrected });
      res.json(result);
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

  // Mounted on /api, after the user-id middleware.
  return function learningLanguage(req, res, next) {
    const lang = String(req.headers['x-learning-language'] || 'ja').toLowerCase();
    if (lang === 'ja') return next(); // Japanese: untouched
    if (!LANGUAGES.includes(lang)) return res.status(400).json({ error: `Unknown learning language: ${lang}`, languages: ['ja', ...LANGUAGES] });
    req.lang = lang;
    if (SHARED.test(req.path)) return next();
    router(req, res, err => {
      if (err) return next(err);
      res.status(501).json({ error: 'NOT_AVAILABLE_FOR_LANGUAGE', message: `${req.method} ${req.path} is not available for "${lang}" yet.` });
    });
  };
}

module.exports = { createMiddleware, LANGUAGES, LEVELS };
