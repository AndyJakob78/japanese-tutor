// The stored side of the progress screen: one record per learner and language
// (collection "progress", document "<user>_<language>") holding
//   days       one line per day: articles read, typed answers, sentences, quizzes, words that became known
//   snapshots  the estimated arrival date as it stood each Monday
//   badges     earned badges with their date
// Recording never throws: a failed write must not break the answer the learner is waiting for.

const { collections } = require('./firestore');
const { recordActivity, dayKey } = require('./progress');

const ref = (userId, lang) => collections.progress.doc(`${userId}_${lang || 'ja'}`);

async function loadRecord(userId, lang) {
  const doc = await ref(userId, lang).get();
  return doc.exists ? doc.data() : {};
}

/** Minutes east of UTC, from the app's X-Timezone-Offset header (0 for older apps). */
function tzOf(req) {
  const n = parseInt(req.headers['x-timezone-offset'], 10);
  return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0;
}

/**
 * Count something the learner just did.
 * @param {object} counts  e.g. { answers: 1, typed: 1 } — see ACTIVE in progress.js
 */
async function bump(req, lang, counts) {
  if (process.env.PROGRESS_READONLY === '1') return;
  try {
    let record = await loadRecord(req.userId, lang);
    const key = dayKey(Date.now(), tzOf(req));
    for (const [kind, n] of Object.entries(counts)) if (n) record = recordActivity(record, key, kind, n);
    await ref(req.userId, lang).set({ user_id: req.userId, language: lang || 'ja', days: record.days, updated_at: new Date().toISOString() }, { merge: true });
  } catch (err) { console.error('progress bump failed:', err.message); }
}

async function saveRecord(userId, lang, patch) {
  if (process.env.PROGRESS_READONLY === '1') return;
  try { await ref(userId, lang).set({ user_id: userId, language: lang || 'ja', ...patch, updated_at: new Date().toISOString() }, { merge: true }); }
  catch (err) { console.error('progress save failed:', err.message); }
}

module.exports = { loadRecord, bump, saveRecord, tzOf };
