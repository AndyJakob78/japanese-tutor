// The progress screen's rules (PROGRESS_SCREEN.md), tested on plain data.

const test = require('node:test');
const assert = require('node:assert');
const { buildProgress, recordActivity, dayKey } = require('../server/services/progress');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-21T10:00:00Z'); // a Saturday
const ago = d => new Date(NOW - d * DAY).toISOString();
const key = d => dayKey(NOW - d * DAY);
const daysOf = (list, what = { answers: 10, typed: 8 }) => Object.fromEntries(list.map(d => [key(d), what]));
const word = (o = {}) => ({ level: 'N4', status: 'learning', times_recalled: 2, times_recalled_correct: 2, ...o });
const knownWords = (n, daysAgo) => Array.from({ length: n }, () => word({ status: 'known', known_at: ago(daysAgo) }));

test('level progress counts only words proven by recall, up to the learner\'s level', () => {
  const p = buildProgress({ lang: 'ja', level: 'N4', now: NOW, words: [
    word({ status: 'known' }), word({ status: 'mastered', level: 'N5' }), word({ status: 'learning' }),
    word({ status: 'known', level: 'N3' }),   // above the level: not counted
    word({ status: 'known', level: null }),   // not on any list
  ] });
  assert.deepStrictEqual(p.progress, { known: 2, total: 1350, percent: 0 });
  assert.deepStrictEqual([p.level, p.next_level], ['N4', 'N3']);
  assert.strictEqual(buildProgress({ lang: 'de', level: 'B2', now: NOW }).next_level, null);
});

test('no estimate from too little data; with data: missing words divided by the four-week pace', () => {
  const thin = buildProgress({ lang: 'ja', level: 'N5', now: NOW, words: knownWords(4, 3), record: { days: daysOf([0, 1, 2]) } });
  assert.deepStrictEqual(thin.estimate, { available: false, need_days: 7, need_words: 6 });
  assert.ok(thin.scenarios.length === 2);   // the pace buttons still say what regular use would give

  // 40 words became known in 28 days = 10 a week; 700 - 40 = 660 missing = 66 weeks = 462 days
  const p = buildProgress({ lang: 'ja', level: 'N5', now: NOW, words: knownWords(40, 5).map(w => ({ ...w, level: 'N5' })), record: { days: daysOf([0, 1, 2, 3, 5, 6, 8, 9, 12, 13, 15]) } });
  assert.strictEqual(p.pace_per_week, 10);
  assert.deepStrictEqual([p.estimate.available, p.estimate.days, p.estimate.value, p.estimate.unit], [true, 462, 15, 'months']);
  assert.strictEqual(p.estimate.date, '2028-02-26');
  // daily review: 10 a day x 100 % right x half (two right days per word) x 7 = 35 a week → 19 weeks, shown as 4 months
  assert.deepStrictEqual(p.scenarios.map(s => [s.key, s.value, s.unit]), [['daily', 4, 'months'], ['more', 3, 'months']]);
});

test('time spans read as days, weeks, months, or over two years', () => {
  const { span } = require('../server/services/progress')._internals;
  assert.deepStrictEqual([span(9), span(42), span(213), span(900)], [{ value: 9, unit: 'days' }, { value: 6, unit: 'weeks' }, { value: 7, unit: 'months' }, { value: null, unit: 'over' }]);
});

test('do this next: the first rule that applies wins', () => {
  const base = { lang: 'ja', level: 'N4', now: NOW };
  const active = { days: daysOf([0, 1]) };
  const due = n => Array.from({ length: n }, () => word({ next_review_at: ago(1) }));
  const kind = d => buildProgress({ ...base, ...d }).next_action.kind;

  assert.strictEqual(kind({}), 'new_article');                                                    // 8: nothing else
  assert.strictEqual(kind({ words: Array.from({ length: 10 }, () => word({ times_recalled: 0 })) }), 'type');   // 6
  assert.strictEqual(kind({ articles: [{ id: 3, created_at: ago(1), read_at: ago(1), quiz_completed_at: null }] }), 'quiz'); // 4
  assert.strictEqual(kind({ articles: [{ id: 3, created_at: ago(1), read_at: ago(1) }, { id: 4, created_at: ago(0), read_at: null }] }), 'read'); // 3 before 4
  assert.strictEqual(kind({ articles: [{ id: 4, created_at: ago(40), read_at: null }] }), 'new_article');   // an old unopened article is not "new"
  // reading counted before the daily record existed: the read dates of articles fill the days
  assert.strictEqual(buildProgress({ ...base, articles: [1, 2, 3].map(d => ({ id: d, created_at: ago(d), read_at: ago(d), quiz_completed_at: ago(d) })) }).streak.current, 3);
  assert.strictEqual(kind({ words: due(4), record: active }), 'new_article');                      // fewer than 5 due
  const review = buildProgress({ ...base, words: due(14), record: active, articles: [{ id: 4, created_at: ago(0), read_at: null }] }).next_action;
  assert.deepStrictEqual([review.kind, review.count, review.minutes], ['review', 10, 3]);         // 2 before 3, at most 10 words
  assert.strictEqual(kind({ words: due(14), record: { days: daysOf([9, 10]) } }), 'welcome_back'); // 1: a week away

  // 5: a pattern 3 times in 30 days, no sentences in the last 3 days, and an article to write about
  const slips = [1, 2, 3].map(d => ({ key: 'wa_ga', label: 'wa ↔ ga', type_label: 'Particle', created_at: ago(d), wrote: 'wa', correct: 'ga', why: 'new information' }));
  const read = [{ id: 7, created_at: ago(9), read_at: ago(8), quiz_completed_at: ago(8) }];
  const p = buildProgress({ ...base, mistakes: slips, articles: read, record: active });
  assert.deepStrictEqual([p.next_action.kind, p.next_action.pattern, p.next_action.article_id], ['practise', 'wa ↔ ga', 7]);
  assert.deepStrictEqual([p.weak_spot.pattern, p.weak_spot.count, p.weak_spot.example.correct], ['wa ↔ ga', 3, 'ga']);
  assert.strictEqual(kind({ ...{ mistakes: slips, articles: read }, record: { days: daysOf([0], { sentences: 3 }) } }), 'new_article'); // practised today
  assert.strictEqual(buildProgress({ ...base, mistakes: slips.slice(0, 2) }).weak_spot, null);     // twice is not a pattern yet

  // 7: a weekly goal that is at least 60 % done
  const goal = buildProgress({ ...base, record: { days: { [key(0)]: { articles: 2 } } } }).next_action;
  assert.deepStrictEqual([goal.kind, goal.goal, goal.count, goal.reason.goal], ['goal', 'articles', 1, true]);
});

test('the reason under the action: days gained and the streak it keeps', () => {
  // pace 10 a week; 7 words are one right answer away from "known"; all typed answers were right → 7 words / (10/7 a day) ≈ 5 days
  const close = Array.from({ length: 7 }, () => word({ next_review_at: ago(0.1), recall_correct_days: [key(2)] }));
  const p = buildProgress({ lang: 'ja', level: 'N4', now: NOW, words: [...knownWords(40, 5), ...close], record: { days: daysOf([1, 2, 3, 4, 6, 8, 9, 12, 13, 15]) } });
  assert.strictEqual(p.next_action.kind, 'review');
  assert.deepStrictEqual(p.next_action.reason, { days_closer: 5, streak: 4 });
  // once today counts, the streak line is gone
  const done = buildProgress({ lang: 'ja', level: 'N4', now: NOW, words: close, record: { days: daysOf([0, 1, 2, 3]) } });
  assert.deepStrictEqual(done.next_action.reason, {});
});

test('streak: counts back from today or yesterday, a missed day ends it; the week runs Monday to Sunday', () => {
  const p = buildProgress({ lang: 'ja', level: 'N4', now: NOW, record: { days: { ...daysOf([1, 2, 3, 4]), ...daysOf([8, 9, 10, 11, 12, 13]), [key(6)]: { known: 2 } } } });
  assert.deepStrictEqual([p.streak.current, p.streak.best, p.streak.active_today], [4, 6, false]);   // a "known" count alone is not activity
  assert.deepStrictEqual(p.streak.next_badge, { days: 7, to_go: 3 });
  assert.deepStrictEqual(p.streak.week.map(d => d.done), [false, true, true, true, true, false, false]);
  assert.deepStrictEqual([p.streak.week[0].date, p.streak.week[5].today], ['2026-11-16', true]);
  assert.strictEqual(buildProgress({ lang: 'ja', level: 'N4', now: NOW, record: { days: daysOf([2, 3]) } }).streak.current, 0);
});

test('days follow the phone\'s time zone', () => {
  const lateEvening = Date.parse('2026-11-21T16:30:00Z');     // 01:30 on the 22nd in Tokyo
  assert.strictEqual(dayKey(lateEvening, 540), '2026-11-22');
  assert.strictEqual(dayKey(lateEvening, 0), '2026-11-21');
  const r = recordActivity(recordActivity({}, '2026-11-22', 'typed', 3), '2026-11-22', 'typed', 2);
  assert.deepStrictEqual(r.days, { '2026-11-22': { typed: 5 } });
});

test('weekly goals: the four weeks before plus 10 %, inside floor and cap', () => {
  const fresh = buildProgress({ lang: 'en', level: 'B1', now: NOW });
  assert.deepStrictEqual(fresh.goals, [{ key: 'articles', done: 0, target: 3 }, { key: 'typed', done: 0, target: 30 }, { key: 'sentences', done: 0, target: 3 }]);
  // the four weeks before this one: 20 articles, 320 typed → 5 and 80 a week → 5.5 → 6, and 88 → 90
  const days = {};
  for (let d = 6; d <= 33; d++) days[key(d)] = { typed: d % 7 === 0 ? 80 : 0, articles: d % 7 === 0 ? 5 : 0 };
  days[key(0)] = { typed: 12, articles: 1, sentences: 99 };
  const p = buildProgress({ lang: 'en', level: 'B1', now: NOW, record: { days } });
  assert.deepStrictEqual(p.goals, [{ key: 'articles', done: 1, target: 6 }, { key: 'typed', done: 12, target: 90 }, { key: 'sentences', done: 99, target: 3 }]);
});

test('"days closer this week" compares with Monday\'s estimate; badges are earned once and kept', () => {
  const data = { lang: 'ja', level: 'N5', now: NOW, words: knownWords(40, 5).map(w => ({ ...w, level: 'N5', times_recalled: 3, times_recalled_correct: 3 })), record: { days: daysOf([0, 1, 2, 3, 5, 6, 8, 9, 12, 13, 15]) } };
  const first = buildProgress(data);
  assert.strictEqual(first.week_gain, null);
  assert.deepStrictEqual(first.save.snapshots, { '2026-11-16': '2028-02-26' });          // remembered for the rest of the week
  assert.strictEqual(first.save.badges['typed:100'], '2026-11-21');                       // 120 right typed answers
  const later = buildProgress({ ...data, record: { ...data.record, snapshots: { '2026-11-16': '2028-03-03' }, badges: { 'typed:100': '2026-11-02' } } });
  assert.deepStrictEqual(later.week_gain, { days: 6 });
  assert.strictEqual(later.save, null);
  assert.strictEqual(later.badges.find(b => b.key === 'typed:100').earned_at, '2026-11-02');
  assert.strictEqual(later.badges.find(b => b.key === 'streak:7').earned_at, null);
  assert.deepStrictEqual(later.badges.filter(b => b.group === 'level').map(b => b.value), ['N5', 'N4', 'N3', 'N2', 'N1']);
});
