// Wires the German / English pipeline to the live services (database, trial).
// server/index.js uses only this file.

const { firestore, collections, collectionsFor, getNextId } = require('../server/services/firestore');
const { checkTrialStatus, incrementGenerationCount, FREE_TRIAL_LIMIT } = require('../server/services/deviceService');
const { generate, searchNews } = require('./generate');
const { createStore } = require('./store');
const { createMiddleware, LEVELS } = require('./server');
const learn = require('./learn');

const stores = {};
const storeFor = lang => (stores[lang] ||= createStore(collectionsFor(lang), () => getNextId(`articles_${lang}`)));

/** The learner's settings that matter here (one read). Level per language: config key "level_de" / "level_en". */
async function loadSettings(userId, lang) {
  const snap = await collections.config.where('user_id', '==', userId).get();
  const cfg = {};
  for (const d of snap.docs) { const { key, value } = d.data(); try { cfg[key] = JSON.parse(value); } catch { cfg[key] = value; } }
  const level = LEVELS.includes(cfg[`level_${lang}`]) ? cfg[`level_${lang}`] : 'A1-A2';
  const topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  return { level, topics };
}

/** News search → writer → reviewer → quiz. Saves nothing (the route does). */
async function generateArticle(userId, lang, opts = {}) {
  const store = storeFor(lang);
  const [settings, recent, vocab] = await Promise.all([loadSettings(userId, lang), store.listArticles(userId, 1, 15), store.listVocabulary(userId)]);
  const level = opts.level || settings.level;
  // rotate through the learner's topics so two articles in a row differ
  const topic = opts.topic || (settings.topics.length ? settings.topics[recent.pagination.total % settings.topics.length] : '');
  const t = Date.now();
  const news = await searchNews(lang, topic, recent.articles.map(a => a.topic || a.title), level);
  console.log(`[${lang} ${level}] news search ${Math.round((Date.now() - t) / 100) / 10}s — ${news.topic}`);
  const mistakes = await store.listMistakes(userId);
  return generate(lang, level, news, {
    knownWords: vocab.slice(0, 150).map(v => v.word),
    reviewWords: learn.pickReviewWords(vocab, 3),
    weakSpots: learn.weakSpots(mistakes, lang),
  });
}

const middleware = createMiddleware({
  storeFor, generateArticle,
  trial: { check: checkTrialStatus, increment: incrementGenerationCount, limit: FREE_TRIAL_LIMIT },
});

module.exports = { middleware, storeFor, generateArticle, _firestore: firestore };
