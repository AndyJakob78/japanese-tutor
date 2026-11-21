// Learning logic for German / English that needs no database and no Claude
// call: the word-review schedule, which words to review next, statistics and
// weak spots. Kept pure so it can be tested directly.

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [1, 3, 7, 14, 30]; // days until the next review, by streak

/**
 * Word status: new → learning → known → mastered.
 *   new       never tested
 *   learning  tested, not yet right twice in a row
 *   known     right twice in a row; comes back after 1, 3, 7, 14, 30 days
 *   mastered  right five times in a row while known
 * A wrong answer resets the streak and moves the word one step back.
 */
function applyTest(word, correct, now = Date.now()) {
  const streak = correct ? (word.streak_correct || 0) + 1 : 0;
  let status = word.status || 'new';
  let next = word.next_review_at || null;
  if (correct) {
    if (status === 'new') status = 'learning';
    if (status === 'learning' && streak >= 2) status = 'known';
    if (status === 'known') {
      if (streak >= INTERVALS.length + 2) { status = 'mastered'; next = null; }
      else next = new Date(now + INTERVALS[Math.min(Math.max(streak - 2, 0), INTERVALS.length - 1)] * DAY).toISOString();
    } else if (status === 'learning') next = new Date(now + DAY).toISOString();
  } else {
    status = status === 'mastered' ? 'known' : 'learning';
    next = new Date(now).toISOString(); // due again right away
  }
  return {
    status, streak_correct: streak, next_review_at: next,
    times_tested: (word.times_tested || 0) + 1,
    times_tested_correct: (word.times_tested_correct || 0) + (correct ? 1 : 0),
    last_tested_at: new Date(now).toISOString(),
  };
}

/** 1 = due, 2 = missed last time, 3 = still learning, 4 = new, 9 = nothing to do. */
function reviewTier(w, now = Date.now()) {
  if (w.status === 'mastered') return 9;
  if (w.next_review_at && Date.parse(w.next_review_at) <= now && (w.times_tested || 0) > 0 && (w.streak_correct || 0) > 0) return 1;
  if ((w.times_tested || 0) > 0 && (w.streak_correct || 0) === 0) return 2;
  if (w.status === 'learning') return 3;
  if (!w.status || w.status === 'new') return 4;
  return 9; // known, not due yet
}

/** Words to review next, most needed first. Words tested in the last 12 hours rest. */
function pickReviewWords(words, limit = 10, now = Date.now()) {
  const rested = w => !w.last_tested_at || now - Date.parse(w.last_tested_at) > DAY / 2;
  return words.filter(rested).map(w => ({ w, tier: reviewTier(w, now) })).filter(x => x.tier < 9)
    .sort((a, b) => a.tier - b.tier || String(a.w.last_seen_at || '').localeCompare(String(b.w.last_seen_at || '')))
    .slice(0, limit).map(x => x.w);
}

/**
 * What the learner types in a review, split from the dictionary form:
 *   "die Regierung, -en" → { article: "die", headword: "Regierung" }
 *   "rise (rose, risen)" → { article: null, headword: "rise" }
 */
function answerParts(base) {
  const main = String(base || '').replace(/\s*\(.*$/, '').split(',')[0].trim();
  // "der/die Jugendliche": both genders — either article is accepted, the first is shown
  const m = main.match(/^(der|die|das)(?:\/(?:der|die|das))?\s+(.+)$/i);
  return m ? { article: m[1].toLowerCase(), headword: m[2] } : { article: null, headword: main };
}

function stats(articles, words, now = Date.now()) {
  const byStatus = { new: 0, learning: 0, known: 0, mastered: 0 };
  let due = 0;
  for (const w of words) {
    byStatus[byStatus[w.status] === undefined ? 'new' : w.status]++;
    if (reviewTier(w, now) === 1) due++;
  }
  const scores = articles.map(a => a.quiz_score).filter(s => typeof s === 'number');
  const days = [...new Set(articles.filter(a => a.read_at).map(a => a.read_at.split('T')[0]))].sort().reverse();
  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i] === new Date(now - i * DAY).toISOString().split('T')[0]) streak++; else break;
  }
  return {
    vocabulary: { total: words.length, byStatus, dueForReview: due },
    articles: { total: articles.length, read: articles.filter(a => a.read_at).length, quizzed: articles.filter(a => a.quiz_completed_at).length },
    quiz: { averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null },
    streak,
  };
}

// --- mistakes from sentence practice ---
const MISTAKE_TYPES = {
  de: { gender: '名詞の性・冠詞', case: '格 (Akkusativ / Dativ)', verb_form: '動詞の形', word_order: '語順', preposition: '前置詞', word_choice: '語の選択', spelling: 'つづり', other: 'その他' },
  en: { article: '冠詞 (a / the)', preposition: '前置詞', tense: '時制', verb_form: '動詞の形', plural: '単数・複数', word_order: '語順', word_choice: '語の選択', spelling: 'つづり', other: 'その他' },
};
const patternKey = p => String(p || '').toLowerCase().replace(/\s*(->|→|=>)\s*/g, ' → ').replace(/\s+/g, ' ').trim();

/** Most frequent mistake patterns first (ties: most recent). */
function weakSpots(mistakes, lang, limit = 5) {
  const groups = new Map();
  for (const m of mistakes) {
    const key = `${m.type}|${m.pattern}`;
    if (!groups.has(key)) groups.set(key, { type: m.type, type_label: (MISTAKE_TYPES[lang] || {})[m.type] || 'その他', pattern: m.pattern, count: 0, last_at: m.created_at, example: { wrote: m.wrote, correct: m.correct, why: m.why, corrected: m.corrected } });
    groups.get(key).count++;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at)).slice(0, limit);
}

module.exports = { applyTest, reviewTier, pickReviewWords, answerParts, stats, weakSpots, patternKey, MISTAKE_TYPES, INTERVALS };
