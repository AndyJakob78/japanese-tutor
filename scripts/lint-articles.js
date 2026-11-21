// Report: what does the code check (agent/middleware/article-lint.js) find in
// the owner's stored articles? READ-ONLY — nothing is written.
//
//   env -u GOOGLE_APPLICATION_CREDENTIALS node scripts/lint-articles.js <owner-device-id> [how-many]
//
// Use it after changing prompts or rules: the number of findings per article
// should go down over time. New articles also carry `lint_warnings` (what was
// left AFTER the reviewer) — the second table counts those.
const { Firestore } = require('@google-cloud/firestore');
const { lintArticle } = require('../agent/middleware/article-lint');

const [owner, limitArg] = process.argv.slice(2);
if (!owner) { console.error('usage: node scripts/lint-articles.js <owner-device-id> [how-many]'); process.exit(1); }
const limit = parseInt(limitArg) || 30;

(async () => {
  const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID || 'japanese-tutor-487503' });
  const snap = await db.collection('articles').where('user_id', '==', owner).get();
  const articles = snap.docs.map(d => d.data())
    .filter(a => (a.writing_system || 'romaji') === 'romaji')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
  const now = {}, saved = {};
  let withSaved = 0;
  for (const a of articles) {
    const findings = lintArticle(a, { proficiency_level: 'N4' });
    findings.forEach(f => { now[f.rule] = (now[f.rule] || 0) + 1; });
    if (Array.isArray(a.lint_warnings)) {
      withSaved++;
      a.lint_warnings.forEach(w => { const r = w.split(':')[0]; saved[r] = (saved[r] || 0) + 1; });
    }
    console.log(`#${a.id} ${String(a.created_at).slice(0, 10)}  ${findings.length} finding(s)${findings.length ? ': ' + findings.map(f => f.rule).join(', ') : ''}`);
  }
  console.log(`\nLast ${articles.length} articles, findings by rule (checked now):`, now);
  console.log(`Articles saved with lint_warnings: ${withSaved}; left after the reviewer, by rule:`, saved);
})();
