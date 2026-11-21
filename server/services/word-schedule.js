// When does a word count as "known"? (2026-11-21)
//
// THE PROBLEM: after five months 371 of the owner's 377 words were still
// "learning". The old rule needed a word to appear in five articles (264 words
// had appeared in one), so almost nothing got a review date. And the 91 %
// test accuracy was mostly multiple choice — recognition, not recall.
//
// THE RULE NOW:
//   - Only RECALL moves a word forward: a typed answer in Daily Review
//     (mode "typed") or the word used correctly in the learner's own sentence
//     (mode "sentence"). Multiple choice (mode "choice", and every app version
//     before 1.5, which sends no mode) is counted but never promotes a word.
//   - learning → known: recalled correctly on two different days.
//   - known: comes back after 1, 3, 7, 14, 30 days; each correct recall moves
//     one step on, the fifth in a row makes it "mastered".
//   - A wrong answer (any mode) resets the streak; two wrong in a row send a
//     known word back to learning; mastered falls back to known.
//
// Pure function, no database — tested in test/word-schedule.test.js.

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [1, 3, 7, 14, 30];
const RECALL_MODES = ['typed', 'sentence'];

/**
 * @param {object} word   the stored vocabulary document
 * @param {boolean} correct
 * @param {string} [mode] "typed" | "sentence" | "choice" (default)
 * @returns {object} the fields to update
 */
function applyTestResult(word, correct, mode, now = Date.now()) {
  const recall = RECALL_MODES.includes(mode);
  const today = new Date(now).toISOString().split('T')[0];
  const streak = correct ? (word.streak_correct || 0) + 1 : 0;
  let days = Array.isArray(word.recall_correct_days) ? word.recall_correct_days : [];
  let recallStreak = word.recall_streak || 0;
  if (recall) {
    recallStreak = correct ? recallStreak + 1 : 0;
    if (correct && !days.includes(today)) days = [...days, today].slice(-10);
  }

  let status = word.status;
  let next = word.next_review_at || null;
  const inDays = n => new Date(now + n * DAY).toISOString();

  if (!correct) {
    if (word.status === 'mastered') { status = 'known'; next = inDays(1); }
    else if (word.status === 'known' && (word.streak_correct || 0) === 0) { status = 'learning'; next = null; }
    else if (word.status === 'known') next = inDays(1);
  } else if (recall) {
    if (word.status === 'learning' && days.length >= 2) { status = 'known'; recallStreak = 1; next = inDays(INTERVALS[0]); }
    else if (word.status === 'known') {
      if (recallStreak >= INTERVALS.length) { status = 'mastered'; next = null; }
      else next = inDays(INTERVALS[Math.max(recallStreak - 1, 0)]);
    }
  }

  return {
    times_tested: (word.times_tested || 0) + 1,
    times_tested_correct: (word.times_tested_correct || 0) + (correct ? 1 : 0),
    streak_correct: streak,
    times_used_correctly: (word.times_used_correctly || 0) + (correct ? 1 : 0),
    times_recalled: (word.times_recalled || 0) + (recall ? 1 : 0),
    times_recalled_correct: (word.times_recalled_correct || 0) + (recall && correct ? 1 : 0),
    recall_streak: recallStreak,
    recall_correct_days: days,
    status,
    next_review_at: next,
    last_tested_at: new Date(now).toISOString(),
  };
}

module.exports = { applyTestResult, INTERVALS, RECALL_MODES };
