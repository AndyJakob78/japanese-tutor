// The news search step on a given model, for a fixed set of requests. Saves nothing.
// Run: SEARCH_MODEL=claude-haiku-5-5 DEBUG_USAGE=1 env -u GOOGLE_APPLICATION_CREDENTIALS \
//      node scripts/timing/search-compare.js <userId> <out.json>
require('dotenv').config();
const fs = require('fs');
const { _internals: P } = require('../../agent/pipeline');

// The same requests for every model: a custom topic fixes what is asked, so the results compare.
const REQUESTS = [
  { custom_topic: 'food and restaurants in Japan' },
  { custom_topic: 'Major League Baseball (MLB) news with Japanese players' },
  { custom_topic: 'science and space' },
  { custom_topic: 'local news from Nagano prefecture' },
  { custom_topic: 'technology and AI' },
  { custom_topic: 'travel and seasonal events in Japan' },
];

(async () => {
  const [userId, out] = process.argv.slice(2);
  const { config, recentArticles } = await P.prefetchAllData(userId, {});
  const results = [];
  for (const [i, req] of REQUESTS.entries()) {   // one after another: clean timings
    const t = Date.now();
    const lines = []; const log = console.log;
    console.log = (...a) => { const s = a.join(' '); if (s.startsWith('SEARCH_USAGE')) lines.push(JSON.parse(s.slice(13))); };
    let news = null, error = null;
    try { news = await P.searchNewsWithTopic({ ...config, ...req }, userId, recentArticles, []); } catch (e) { error = e.message; }
    console.log = log;
    const sum = k => lines.reduce((n, u) => n + (u[k] || 0), 0);
    results.push({ item: i, request: req.custom_topic, seconds: Math.round((Date.now() - t) / 100) / 10, attempts: lines.length, error,
      usage: { input: sum('input'), output: sum('output'), cache_read: sum('cache_read'), cache_write: sum('cache_write'), searches: sum('searches') }, news });
    console.log(`${process.env.SEARCH_MODEL || 'default'} ${i}: ${results[i].seconds}s, searches ${results[i].usage.searches}, ${error ? 'ERROR ' + error.slice(0, 80) : String(news.topic).slice(0, 70)}`);
  }
  fs.writeFileSync(out, JSON.stringify({ model: process.env.SEARCH_MODEL || 'default', level: config.proficiency_level, results }, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
