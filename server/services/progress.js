// The progress screen: time to the next level, what to do next, streak,
// weekly goals and badges. The rules are written out in PROGRESS_SCREEN.md —
// change them there and here together.
//
// Pure functions: everything comes in as plain data, nothing is read or
// written here, and no AI call is made. Tested in test/progress.test.js.

const DAY = 24 * 60 * 60 * 1000;

// Level lists: how many words a learner has to know up to and including a level.
// Japanese: the JLPT word lists in agent/middleware/data/jlpt-vocab.
// English: the CEFR-J list (multilang/data/en-cefrj.csv).
// German: no free list with levels exists; these are the usual course targets
// (Goethe word lists for A2 and B1, an estimate for B2), so the German numbers are rougher.
const COURSES = {
  ja: { levels: ['N5', 'N4', 'N3', 'N2', 'N1'], sizes: [700, 1350, 3185, 5031, 8506] },
  en: { levels: ['A1-A2', 'B1', 'B2'], sizes: [2575, 5021, 7799] },
  de: { levels: ['A1-A2', 'B1', 'B2'], sizes: [1300, 2400, 5000] },
};

const GOALS = [
  { key: 'articles', floor: 3, cap: 10, round: 1 },
  { key: 'typed', floor: 30, cap: 150, round: 10 },
  { key: 'sentences', floor: 3, cap: 15, round: 1 },
];
const BADGES = [
  ...[7, 30, 100].map(n => ({ key: `streak:${n}`, group: 'streak', value: n })),
  ...[100, 500, 1000].map(n => ({ key: `typed:${n}`, group: 'typed', value: n })),
  ...[25, 100, 250].map(n => ({ key: `articles:${n}`, group: 'articles', value: n })),
];
const ACTIVE = ['articles', 'answers', 'sentences', 'quizzes']; // any of these makes a day count

/** The learner's calendar day ("2026-11-22") — their phone's time zone, not the server's. */
const dayKey = (now, tzOffsetMin = 0) => new Date(now + tzOffsetMin * 60000).toISOString().slice(0, 10);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const mondayOf = key => addDays(key, -((new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7));
const isActive = d => !!d && ACTIVE.some(k => (d[k] || 0) > 0);

/** Add to today's line of the daily record. Returns the changed record. */
function recordActivity(record, key, kind, n = 1) {
  const days = { ...((record && record.days) || {}) };
  days[key] = { ...(days[key] || {}), [kind]: ((days[key] || {})[kind] || 0) + n };
  return { ...(record || {}), days };
}

/** "9 days", "6 weeks", "7 months" — or over two years. */
function span(days) {
  if (days > 730) return { value: null, unit: 'over' };
  if (days < 14) return { value: Math.max(1, Math.round(days)), unit: 'days' };
  if (days <= 70) return { value: Math.round(days / 7), unit: 'weeks' };
  return { value: Math.round(days / 30.4), unit: 'months' };
}

function streaks(days, today) {
  let current = 0;
  for (let k = isActive(days[today]) ? today : addDays(today, -1); isActive(days[k]); k = addDays(k, -1)) current++;
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(days).filter(k => isActive(days[k])).sort()) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { current, best: Math.max(best, current) };
}

const sumDays = (days, from, to, kind) => {
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) n += (days[k] || {})[kind] || 0;
  return n;
};

/**
 * @param {object} d
 * @param {'ja'|'de'|'en'} d.lang
 * @param {string} d.level        the learner's level setting
 * @param {object[]} d.words      {level, status, known_at, next_review_at, times_recalled, times_recalled_correct, recall_correct_days}
 * @param {object[]} d.articles   {id, created_at, read_at, quiz_completed_at}
 * @param {object[]} d.mistakes   {key, label, type_label, created_at, wrote, correct, why}
 * @param {object} d.record       the stored daily record ({days, snapshots, badges})
 * @param {number} d.now, d.tzOffsetMin
 * @returns the screen's data, plus `save` (what to store back) when something new was earned or snapshotted
 */
function buildProgress({ lang, level, words = [], articles = [], mistakes = [], record = {}, now = Date.now(), tzOffsetMin = 0 }) {
  const course = COURSES[lang] || COURSES.ja;
  const at = Math.max(0, course.levels.indexOf(level));
  const today = dayKey(now, tzOffsetMin);
  // Days from before the daily record existed: an article's read date is known, so reading
  // counts for those days. A learner's streak and weekly goal do not start at zero on the
  // day the new version arrives.
  const days = { ...(record.days || {}) };
  for (const a of articles) {
    if (!a.read_at) continue;
    const k = dayKey(Date.parse(a.read_at), tzOffsetMin);
    if (!(record.days || {})[k]) days[k] = { ...(days[k] || {}), articles: ((days[k] || {}).articles || 0) + 1 };
  }

  // ---- 1. level progress and time to the next level ----
  const total = course.sizes[at];
  const inLevel = w => { const i = course.levels.indexOf(w.level); return i >= 0 && i <= at; };
  const isKnown = w => w.status === 'known' || w.status === 'mastered';
  const known = Math.min(total, words.filter(w => inLevel(w) && isKnown(w)).length);
  const since = now - 28 * DAY;
  const newlyKnown = words.filter(w => w.known_at && Date.parse(w.known_at) >= since).length;
  const pace = newlyKnown / 4; // words a week
  const activeDays = Object.keys(days).filter(k => k > addDays(today, -28) && isActive(days[k])).length;
  const remaining = total - known;
  const ready = activeDays >= 10 && newlyKnown >= 10;
  const etaOf = perWeek => {
    const d = (remaining / perWeek) * 7;
    return { ...span(d), date: d > 730 ? null : dayKey(now + d * DAY, tzOffsetMin), days: Math.round(d) };
  };
  const estimate = remaining === 0 ? { available: true, done: true }
    : ready ? { available: true, ...etaOf(pace) }
      : { available: false, need_days: Math.max(1, 10 - activeDays), need_words: Math.max(0, 10 - newlyKnown) };

  // the pace buttons: the learner's own share of right typed answers; a word needs two right days
  const recalled = words.reduce((n, w) => n + (w.times_recalled || 0), 0);
  const recalledRight = words.reduce((n, w) => n + (w.times_recalled_correct || 0), 0);
  const accuracy = recalled >= 20 ? recalledRight / recalled : 0.7;
  const scenarios = remaining === 0 ? [] : [['daily', 10], ['more', 15]]
    .map(([key, perDay]) => ({ key, perWeek: perDay * accuracy * 0.5 * 7 }))
    .filter(s => !ready || s.perWeek > pace * 1.05)
    .map(s => ({ key: s.key, ...etaOf(s.perWeek) }));

  // ---- 4. streak and this week ----
  const streak = streaks(days, today);
  const monday = mondayOf(today);
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => { const k = addDays(monday, i); return { date: k, done: isActive(days[k]), today: k === today }; });
  const nextStreak = [7, 30, 100].find(n => n > streak.current) || null;

  // ---- 6. weekly goals: the average of the four weeks before, plus 10 % ----
  const goals = GOALS.map(g => {
    const before = sumDays(days, addDays(monday, -28), addDays(monday, -1), g.key) / 4;
    const target = Math.min(g.cap, Math.max(g.floor, Math.round((before * 1.1) / g.round) * g.round));
    return { key: g.key, done: sumDays(days, monday, addDays(monday, 6), g.key), target };
  });

  // ---- 3. weak spot: the most frequent mistake pattern of the last 60 days, at least 3 times ----
  const groups = new Map();
  for (const m of mistakes) {
    if (Date.parse(m.created_at) < now - 60 * DAY) continue;
    const g = groups.get(m.key) || { key: m.key, pattern: m.label, type_label: m.type_label, count: 0, recent: 0, last_at: '', example: null };
    g.count++;
    if (Date.parse(m.created_at) >= now - 30 * DAY) g.recent++;
    if (m.created_at > g.last_at) { g.last_at = m.created_at; g.example = { wrote: m.wrote, correct: m.correct, why: m.why }; }
    groups.set(m.key, g);
  }
  const weak = [...groups.values()].filter(g => g.count >= 3).sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at))[0] || null;

  // ---- 2. do this next: the first rule that applies ----
  const activeKeys = Object.keys(days).filter(k => isActive(days[k])).sort();
  const lastActive = activeKeys[activeKeys.length - 1] || null;
  const away = lastActive ? Math.round((Date.parse(today) - Date.parse(lastActive)) / DAY) : 0;
  const due = words.filter(w => w.status !== 'mastered' && w.next_review_at && Date.parse(w.next_review_at) <= now).length;
  const byNewest = [...articles].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const unread = byNewest.find(a => !a.read_at && Date.parse(a.created_at) >= now - 14 * DAY); // an old unopened article is not "new"
  const noQuiz = byNewest.find(a => a.read_at && Date.parse(a.read_at) >= now - 3 * DAY && !a.quiz_completed_at);
  const lastRead = byNewest.find(a => a.read_at);
  const neverTyped = words.filter(w => !isKnown(w) && !(w.times_recalled > 0)).length;
  const sentencesLately = sumDays(days, addDays(today, -2), today, 'sentences');
  const nearGoal = goals.find(g => g.done < g.target && g.done / g.target >= 0.6);
  const minutes = n => Math.max(1, Math.ceil((n * 15) / 60));

  let next;
  if (lastActive && away >= 7) next = { kind: 'welcome_back', count: 5, minutes: 2 };
  else if (due >= 5) next = { kind: 'review', count: Math.min(due, 10), minutes: minutes(Math.min(due, 10)) };
  else if (unread) next = { kind: 'read', article_id: unread.id, minutes: 4 };
  else if (noQuiz) next = { kind: 'quiz', article_id: noQuiz.id, minutes: 2 };
  else if (weak && weak.recent >= 3 && sentencesLately === 0 && lastRead) next = { kind: 'practise', pattern: weak.pattern, article_id: lastRead.id, count: 5 };
  else if (neverTyped >= 10) next = { kind: 'type', count: 10, minutes: 3 };
  else if (nearGoal) next = { kind: 'goal', goal: nearGoal.key, count: nearGoal.target - nearGoal.done, article_id: nearGoal.key === 'sentences' && lastRead ? lastRead.id : undefined };
  else next = { kind: 'new_article' };

  // the line under the action: time gained, the streak it keeps, the goal it completes
  const reason = {};
  if (['welcome_back', 'review', 'type'].includes(next.kind) && estimate.available && !estimate.done && pace > 0) {
    // words one more right answer on a new day would make "known"
    const close = words.filter(w => w.status === 'learning' && (w.recall_correct_days || []).length >= 1 && !(w.recall_correct_days || []).includes(today)).length;
    const gained = Math.round((Math.min(close, next.count) * accuracy) / (pace / 7));
    if (gained >= 1) reason.days_closer = gained;
  }
  if (!isActive(days[today]) && streak.current >= 3) reason.streak = streak.current;
  if (next.kind === 'goal') reason.goal = true;
  next.reason = reason;

  // ---- 5. this week you pulled the next level X days closer ----
  const save = {};
  let weekGain = null;
  if (estimate.available && estimate.date) {
    const snapshot = (record.snapshots || {})[monday];
    if (!snapshot) save.snapshots = { ...(record.snapshots || {}), [monday]: estimate.date };
    else weekGain = { days: Math.round((Date.parse(snapshot) - Date.parse(estimate.date)) / DAY) };
  }

  // ---- 7. badges: earned once, kept ----
  const have = record.badges || {};
  const readCount = articles.filter(a => a.read_at).length;
  const earnedNow = key => {
    const [group, value] = key.split(':');
    if (group === 'streak') return streak.best >= Number(value);
    if (group === 'typed') return recalledRight >= Number(value);
    if (group === 'articles') return readCount >= Number(value);
    const i = course.levels.indexOf(value); // level
    return words.filter(w => { const j = course.levels.indexOf(w.level); return j >= 0 && j <= i && isKnown(w); }).length >= course.sizes[i];
  };
  const badges = [...course.levels.map(l => ({ key: `level:${l}`, group: 'level', value: l })), ...BADGES].map(b => {
    const earned_at = have[b.key] || (earnedNow(b.key) ? today : null);
    return { ...b, earned_at };
  });
  const fresh = badges.filter(b => b.earned_at && !have[b.key]);
  if (fresh.length) save.badges = { ...have, ...Object.fromEntries(fresh.map(b => [b.key, b.earned_at])) };

  return {
    language: lang, level: course.levels[at], next_level: course.levels[at + 1] || null,
    progress: { known, total, percent: Math.round((known / total) * 100) },
    pace_per_week: Math.round(pace * 10) / 10,
    estimate, scenarios,
    next_action: next,
    weak_spot: weak && { pattern: weak.pattern, type_label: weak.type_label, count: weak.count, example: weak.example, article_id: lastRead ? lastRead.id : null },
    streak: { current: streak.current, best: streak.best, active_today: isActive(days[today]), week, next_badge: nextStreak && { days: nextStreak, to_go: nextStreak - streak.current } },
    week_gain: weekGain,
    goals,
    badges,
    totals: { words: words.length, due, typed_right: recalledRight, articles_read: readCount },
    save: Object.keys(save).length ? save : null,
  };
}

module.exports = { buildProgress, recordActivity, dayKey, COURSES, _internals: { span, streaks, mondayOf, addDays } };
