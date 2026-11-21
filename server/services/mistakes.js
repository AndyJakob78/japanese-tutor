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

// Fixed catalogue of mistake patterns (2026-11-21).
// Before, Claude worded the pattern freely, so the same slip got a new label
// every time: 11 particle mistakes had 11 labels and the top "weak spot" had a
// count of 2. Now every correction is filed under ONE key from this list, so
// repeats add up. `re` files the older, freely worded mistakes at read time —
// the stored documents are not changed.
const PATTERNS = [
  { key: 'wa-ga', type: 'particle', label: 'wa ↔ ga (topic or subject)', re: /\b(wa|ga) → (wa|ga)\b|missing ga\b/ },
  { key: 'wo-ga-intransitive', type: 'particle', label: 'wo → ga with verbs that happen by themselves (agaru, fueru, kimaru)', re: /wo → ga|intransitive/ },
  { key: 'object-wo', type: 'particle', label: 'wo for the object of an action', re: /→ wo\b|missing wo\b|object of/ },
  { key: 'ni-de', type: 'particle', label: 'ni ↔ de (where something is / where something happens / by what means)', re: /\b(ni|wo) → de\b|place of action/ },
  { key: 'ni-e-direction', type: 'particle', label: 'ni / e for direction and goal', re: /\b(wo|de|ga) → (ni|e)\b|direction|destination/ },
  { key: 'missing-no', type: 'particle', label: 'no between two nouns', re: /missing no\b|between two nouns/ },
  { key: 'to-quote', type: 'particle', label: 'quoting: ... (da) to iimashita / to omoimasu', re: /quot|\bda to\b|to ii|to omo/ },
  { key: 'other-particle', type: 'particle', label: 'other particles (mo, kara, made, yori, to)', re: null },
  { key: 'verb-pair', type: 'verb_form', label: 'verb pairs: does it itself / someone does it (agaru–ageru, aku–akeru, kimaru–kimeru)', re: /transitive|verb pair|agaru|ageru|fueru|fuyasu|kimaru|kimeru|sagaru|sageru|hiraku|akeru/ },
  { key: 'te-form', type: 'verb_form', label: 'te-form', re: /te-form|\bte form/ },
  { key: 'compound-verb', type: 'verb_form', label: 'verb stem + tsuzukeru / hajimeru / owaru', re: /tsuzukeru|hajimeru|stem \+/ },
  { key: 'koto-nominal', type: 'verb_form', label: 'dictionary form + koto / no (doing something)', re: /koto\b|nominal/ },
  { key: 'noun-suru', type: 'verb_form', label: 'noun + suru to make a verb', re: /suru\b/ },
  { key: 'potential', type: 'verb_form', label: 'can do: potential form / koto ga dekiru', re: /potential|dekiru|rareru/ },
  { key: 'tense-aspect', type: 'verb_form', label: 'tense: -mashita, -te imasu, -masu', re: /tense|te imasu|mashita|past|ongoing/ },
  { key: 'other-verb-form', type: 'verb_form', label: 'other verb forms (-tai, -nai, plain form before a noun)', re: null },
  { key: 'reason-node-kara', type: 'word_order', label: 'reasons: ... node / kara', re: /node\b|because/ },
  { key: 'embedded-question', type: 'word_order', label: 'question inside a sentence: ... ka (dōka)', re: /embedded|dōka/ },
  { key: 'word-order', type: 'word_order', label: 'word order', re: null },
  { key: 'na-adjective', type: 'adjective', label: 'na-adjective + na + noun', re: /na-adj|→ na\b/ },
  { key: 'i-adjective', type: 'adjective', label: 'i-adjective forms (-ku naru, -kunai, -katta)', re: null },
  { key: 'spelling', type: 'word_choice', label: 'spelling (long vowels, loanwords)', re: /spell|loanword|long vowel|iie → ie/ },
  { key: 'wrong-word', type: 'word_choice', label: 'wrong word for the meaning', re: null },
  { key: 'other', type: 'other', label: 'other', re: null },
];
const PATTERN_BY_KEY = Object.fromEntries(PATTERNS.map(p => [p.key, p]));
const FALLBACK_KEY = { particle: 'other-particle', verb_form: 'other-verb-form', word_order: 'word-order', adjective: 'i-adjective', word_choice: 'wrong-word', other: 'other' };

/** The catalogue key of a mistake: its own key, or (older mistakes) guessed from the free label. */
function patternKeyOf(m) {
  if (m.pattern_key && PATTERN_BY_KEY[m.pattern_key]) return m.pattern_key;
  // The label says most: a pattern of the same type first, then any pattern
  // (Claude's type is sometimes off). Only if the label says nothing, look at
  // what was written and corrected, and then only inside the same type.
  const label = patternKey(m.pattern);
  const change = patternKey(`${m.wrote} → ${m.correct}`);
  const hit = PATTERNS.find(p => p.type === m.type && p.re && p.re.test(label))
    || PATTERNS.find(p => p.re && p.re.test(label))
    || PATTERNS.find(p => p.type === m.type && p.re && p.re.test(change));
  return hit ? hit.key : FALLBACK_KEY[m.type] || 'other';
}

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
        pattern_key: patternKeyOf(f),
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
  // Grouped by the fixed catalogue key, so the same kind of slip adds up.
  const groups = new Map();
  for (const m of mistakes) {
    const key = patternKeyOf(m);
    const entry = PATTERN_BY_KEY[key];
    if (!groups.has(key)) {
      groups.set(key, {
        type: entry.type, type_label: TYPE_LABELS[entry.type] || 'Other', pattern: entry.label, pattern_key: key,
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
Where a pattern fits a sentence the story needs anyway, use it correctly there. NEVER add a sentence, scene, opinion or detail just to practise a pattern — the news facts always win (e.g. no "people open the factory door in the morning" to practise akeru). A pattern that doesn't fit the story goes into one grammar_point instead, with its own example sentence that shows the correct form. One grammar_point covers ONE pattern.`;
}

module.exports = { PATTERNS, patternKeyOf, TYPES, TYPE_LABELS, patternKey, saveMistakes, loadMistakes, summarizeWeakSpots, weakSpotsPrompt };
