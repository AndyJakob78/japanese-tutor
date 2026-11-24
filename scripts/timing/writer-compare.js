// Side-by-side: the same news items written with two writer efforts. Saves nothing to the database.
// Run: WRITER_EFFORT=low env -u GOOGLE_APPLICATION_CREDENTIALS node scripts/timing/writer-compare.js <userId> <out.json>
require('dotenv').config();
const fs = require('fs');
const { _internals: P } = require('../../agent/pipeline');

const ITEMS = [
  { category: 'travel', region: 'tokyo', articles: [{ source: 'Japan National Tourism Organization', headline: 'Japan has a record October for foreign visitors',
    keyFacts: ['About 3.91 million foreign visitors came in October', 'The most for any single month', 'Autumn leaves and holidays in Asia and Europe helped', 'Twenty markets had October records'], numbers: ['3.91 million', '0.4%', '20 markets'] }] },
  { category: 'food', region: 'osaka', articles: [{ source: 'NHK', headline: 'Osaka bakery wins national bread contest',
    keyFacts: ['A small bakery in Osaka won first prize in a national bread contest', 'Its melon bread uses yuzu from Kochi', 'The owner started the shop ten years ago with his wife', 'Lines now form before the shop opens at 7 a.m.'], numbers: ['10 years', '7 a.m.', '1,200 entries'] }] },
  { category: 'sport', region: 'japan', articles: [{ source: 'Kyodo', headline: 'Japanese pitcher visits Chicago Cubs',
    keyFacts: ['A Japanese pitcher visited the Chicago Cubs this week', 'He wants to play in Major League Baseball', 'He must agree to a deal with a team by December 1', 'Last season in Japan he won 10 games and lost 10'], numbers: ['December 1', '10 wins', '3.18 ERA'] }] },
  { category: 'weather', region: 'hokkaido', articles: [{ source: 'Japan Meteorological Agency', headline: 'First snow of the season in Sapporo',
    keyFacts: ['Sapporo saw its first snow of the season on Tuesday', 'It came five days later than usual', 'Temperatures will drop below zero this weekend', 'The agency asks drivers to change to winter tires'], numbers: ['5 days', '-3°C', 'Tuesday'] }] },
];

(async () => {
  const [userId, out] = process.argv.slice(2);
  const { config, knownWords } = await P.prefetchAllData(userId, {});
  const results = await Promise.all(ITEMS.map(async (news, i) => {
    const t = Date.now();
    const r = await P.generateArticleWithVocab(news, config, userId, knownWords);
    return { item: i, seconds: Math.round((Date.now() - t) / 100) / 10, title: r.title_romaji, body: r.body_romaji, translation_en: r.translation_en,
      grammar_points: r.grammar_points, newWords: (r.newWords || []).map(w => `${w.word_romaji_macron} (${w.jlpt_level}) ${w.meaning_en}`), word_count: r.word_count };
  }));
  fs.writeFileSync(out, JSON.stringify({ effort: process.env.WRITER_EFFORT, level: config.proficiency_level, news: ITEMS, results }, null, 1));
  console.log(process.env.WRITER_EFFORT, results.map(r => `${r.item}:${r.seconds}s/${r.word_count}w`).join('  '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
