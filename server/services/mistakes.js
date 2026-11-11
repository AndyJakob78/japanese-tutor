// Mistake memory (2026-11-11)
//
// Sentence building used to show its corrections once and forget them: the
// word-level result moved the word's review schedule, but the grammar slips
// (ga vs wo, verb endings, word order) were lost. Each correction is now
// saved with a type and a short pattern, so the app can bring weak spots back:
//   - the next sentence session opens with a focus hint (GET /api/practice/mistakes)
//   - new articles use those patterns on purpose (agent/pipeline.js)
//   - the learner can read their own list ("My mistakes" in the app)
//
// Firestore collection "mistakes", one document per correction:
//   { user_id, created_at, type, pattern, wrote, correct, why, sentence, corrected }

const { collections } = require('./firestore');

const TYPES = ['particle', 'verb_form', 'word_order', 'word_choice', 'adjective', 'other'];
const TYPE_LABELS = {
  particle: 'Particles',
  verb_form: 'Verb forms',
  word_order: 'Word order',
  word_choice: 'Word choice',
  adjective: 'Adjectives',
  other: 'Other',
};
const WINDOW_DAYS = 60;

/** Normalise a pattern key so "WO → GA", "wo->ga" and "wo → ga " group together. */
function patternKey(p) {
  return String(p || '').toLowerCase().replace(/\s*(->|→|=>)\s*/g, ' → ').replace(/\s+/g, ' ').trim();
}

/** Save the corrections of one checked sentence. Never throws (a failed save must not break the check). */
async function saveMistakes(userId, { fixes, sentence, corrected }) {
  if (!userId || !Array.isArray(fixes) || fixes.length === 0) return 0;
  if (process.env.MISTAKES_READONLY === '1') return 0;   // local testing / screenshots: never save
  try {
    const now = new Date().toISOString();
    const batch = collections.mistakes.firestore.batch();
    for (const f of fixes) {
      batch.set(collections.mistakes.doc(), {
        user_id: userId,
        created_at: now,
        type: TYPES.includes(f.type) ? f.type : 'other',
        pattern: patternKey(f.pattern) || patternKey(`${f.wrote} → ${f.correct}`),
        wrote: f.wrote,
        correct: f.correct,
        why: f.why,
        sentence: String(sentence || '').slice(0, 300),
        corrected: String(corrected || '').slice(0, 300),
      });
    }
    await batch.commit();
    return fixes.length;
  } catch (err) {
    console.error('saveMistakes failed:', err.message);
    return 0;
  }
}

/** The learner's recent mistakes, newest first. */
async function loadMistakes(userId, { days = WINDOW_DAYS } = {}) {
  const snap = await collections.mistakes.where('user_id', '==', userId).get();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return snap.docs
    .map(d => d.data())
    .filter(m => Date.parse(m.created_at) >= since)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Group mistakes into weak spots, most frequent first (ties: most recent).
 * A pattern seen once is still listed, but repeated ones come first.
 */
function summarizeWeakSpots(mistakes, limit = 5) {
  const groups = new Map();
  for (const m of mistakes) {
    const key = `${m.type}|${m.pattern}`;
    if (!groups.has(key)) {
      groups.set(key, {
        type: m.type, type_label: TYPE_LABELS[m.type] || 'Other', pattern: m.pattern,
        count: 0, last_at: m.created_at, example: { wrote: m.wrote, correct: m.correct, why: m.why, corrected: m.corrected },
      });
    }
    groups.get(key).count++;
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at))
    .slice(0, limit);
}

/** Text block for the article prompt, or '' when there is nothing to work on. */
function weakSpotsPrompt(weakSpots) {
  const spots = (weakSpots || []).slice(0, 3);
  if (spots.length === 0) return '';
  const lines = spots.map(s => `- ${s.type_label}: ${s.pattern} — e.g. the student wrote "${s.example.wrote}", correct is "${s.example.correct}" (${s.example.why})`);
  return `## The student's weak spots (from sentences they wrote themselves)
${lines.join('\n')}
Use each of these patterns correctly at least once in the body, in a natural sentence. If one fits the story, make one of the grammar_points about it, with an example that shows the correct form.`;
}

module.exports = { TYPES, TYPE_LABELS, patternKey, saveMistakes, loadMistakes, summarizeWeakSpots, weakSpotsPrompt };
