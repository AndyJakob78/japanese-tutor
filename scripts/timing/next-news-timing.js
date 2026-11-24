// Times an article that uses a story found beforehand (agent/next-news.js) vs. the normal search.
// The stored story is kept in memory here — nothing is written to the database.
// Run: env -u GOOGLE_APPLICATION_CREDENTIALS node scripts/timing/next-news-timing.js <userId>
require('dotenv').config();
const nextNews = require('../../agent/next-news');
const { _internals: P } = require('../../agent/pipeline');

const mem = {};
const fakeCollections = { nextNews: { doc: id => ({
  get: async () => ({ exists: !!mem[id], data: () => mem[id] }),
  set: async v => { mem[id] = v; }, delete: async () => { delete mem[id]; } }) } };

(async () => {
  const userId = process.argv[2];
  const { config, recentArticles, knownWords } = await P.prefetchAllData(userId, {});
  let t = Date.now();
  await nextNews.prepareStory(fakeCollections, userId, config, recentArticles, P.searchNewsWithTopic);
  console.log(`background search (the learner does not wait for this): ${((Date.now() - t) / 1000).toFixed(1)}s`);
  t = Date.now();
  const ready = await nextNews.takeStory(fakeCollections, userId, config, recentArticles);
  console.log(`stored story used: ${!!ready} ("${String(ready && ready.topic).slice(0, 70)}")`);
  const a = await P.generateArticleWithVocab(ready, config, userId, knownWords);
  console.log(`ARTICLE READY after ${((Date.now() - t) / 1000).toFixed(1)}s (no search) — "${a.title_romaji}", ${a.word_count} words`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
