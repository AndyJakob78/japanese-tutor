// Wires the German / English pipeline to the live services (database, trial).
// server/index.js uses only this file.

const { firestore, collections, collectionsFor, getNextId } = require('../server/services/firestore');
const { checkTrialStatus, incrementGenerationCount, FREE_TRIAL_LIMIT } = require('../server/services/deviceService');
const { generate, searchNews } = require('./generate');
const { createStore } = require('./store');
const { createMiddleware, LEVELS } = require('./server');
const learn = require('./learn');
const { effective } = require('./settings');
const progressStore = require('../server/services/progress-store');
const { LANGS } = require('./generate');

const stores = {};
const storeFor = lang => (stores[lang] ||= createStore(collectionsFor(lang), () => getNextId(`articles_${lang}`)));

// The learner's settings of one language: ONE config record, key "settings_de" /
// "settings_en", holding the whole (sparse) settings object of ./settings.js.
// "level_de" / "level_en" is the level record app 1.5 may have written.
const settings = {
  async load(userId, lang) {
    const snap = await collections.config.where('user_id', '==', userId).get();
    let stored = {}, oldLevel = null;
    for (const d of snap.docs) {
      const { key, value } = d.data();
      if (key === `settings_${lang}`) { try { stored = JSON.parse(value) || {}; } catch { stored = {}; } }
      if (key === `level_${lang}`) oldLevel = value;
    }
    if (!stored.proficiency_level && LEVELS.includes(oldLevel)) stored.proficiency_level = oldLevel;
    return stored;
  },
  async save(userId, lang, stored) {
    const snap = await collections.config.where('user_id', '==', userId).where('key', '==', `settings_${lang}`).limit(1).get();
    const doc = { key: `settings_${lang}`, value: JSON.stringify(stored), user_id: userId, updated_at: new Date().toISOString() };
    if (snap.empty) await collections.config.doc().set(doc); else await snap.docs[0].ref.update(doc);
  },
};

/** News search → writer → reviewer → quiz. Saves nothing (the route does). */
async function generateArticle(userId, lang, opts = {}) {
  const store = storeFor(lang);
  const [stored, recent, vocab] = await Promise.all([settings.load(userId, lang), store.listArticles(userId, 1, 15), store.listVocabulary(userId)]);
  // opts.request: what the "New Article" form sent (app 1.6+); opts.level: app 1.5
  const eff = effective(LANGS[lang], stored, opts.request || { proficiency_level: opts.level });
  const level = eff.level;
  // rotate through the learner's topics so two articles in a row differ
  const topic = opts.topic || (eff.topics.length ? eff.topics[recent.pagination.total % eff.topics.length] : '');
  const t = Date.now();
  const news = await searchNews(lang, topic, recent.articles.map(a => a.topic || a.title), level, { regions: eff.regions, days: eff.days });
  console.log(`[${lang} ${level}] news search ${Math.round((Date.now() - t) / 100) / 10}s — ${news.topic}`);
  const mistakes = await store.listMistakes(userId);
  return generate(lang, level, news, {
    knownWords: vocab.slice(0, 150).map(v => v.word),
    reviewWords: learn.pickReviewWords(vocab, eff.rules.reviewCount),
    weakSpots: learn.weakSpots(mistakes, lang),
    rules: eff.rules,
  });
}

const middleware = createMiddleware({
  storeFor, generateArticle, settings,
  progress: { bump: progressStore.bump, load: progressStore.loadRecord, save: progressStore.saveRecord, tz: progressStore.tzOf },
  trial: { check: checkTrialStatus, increment: incrementGenerationCount, limit: FREE_TRIAL_LIMIT },
});

module.exports = { middleware, storeFor, generateArticle, _firestore: firestore };
