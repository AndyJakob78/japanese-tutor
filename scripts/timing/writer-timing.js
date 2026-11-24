// Times ONLY the Japanese writing step (generateArticleWithVocab) on a fixed news item.
// Reads the owner's config and words (read only); saves nothing.
// Run: DEBUG_USAGE=1 env -u GOOGLE_APPLICATION_CREDENTIALS node scripts/timing/writer-timing.js <userId> [runs]
require('dotenv').config();
const { _internals: P } = require('../../agent/pipeline');

const news = {
  category: 'travel', region: 'tokyo',
  articles: [{
    source: 'Japan National Tourism Organization', headline: 'Japan has a record October for foreign visitors',
    keyFacts: ['About 3.91 million foreign visitors came in October', 'The most for any single month', 'Autumn leaves and holidays in Asia and Europe helped', 'Twenty markets had October records'],
    numbers: ['3.91 million', '0.4%', '20 markets'],
  }],
};

(async () => {
  const userId = process.argv[2]; const runs = Number(process.argv[3] || 1);
  const { config, knownWords } = await P.prefetchAllData(userId, {});
  for (let i = 1; i <= runs; i++) {
    const t = Date.now();
    const r = await P.generateArticleWithVocab(news, config, userId, knownWords);
    if (process.env.SHOW) console.log("BODY:\n" + r.body_romaji + "\nEN:\n" + r.translation_en + "\nGRAMMAR: " + JSON.stringify(r.grammar_points));
    console.log(`RUN ${i}: ${((Date.now() - t) / 1000).toFixed(1)}s, words ${r.word_count}, body chars ${(r.body_romaji || '').length}, translation chars ${(r.translation_en || '').length}, grammar ${JSON.stringify(r.grammar_points || []).length} chars, newWords ${(r.newWords || []).length} (${JSON.stringify(r.newWords || []).length} chars)`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
