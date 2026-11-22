// Settings for German / English, one set per language and learner.
//
// The app shows the SAME settings screen as for Japanese, so this file speaks
// the shape of the Japanese /api/config (proficiency_level, topics, ...).
//
// Stored sparsely: article length, sentence length and new words follow the
// level until the learner changes them. A learner who only switches from
// A1-A2 to B2 gets B2 articles, not B2 words in 14-word sentences.
//
// Pure functions, no database — tested in test/multilang-settings.test.js.

const LEVELS = ['A1-A2', 'B1', 'B2'];
const DEFAULT_TOPICS = ['science', 'technology', 'culture', 'society and daily life', 'nature and environment'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round50 = n => clamp(Math.round(n / 50) * 50, 100, 500);

// what the settings screen shows while a value is "automatic"
function levelDefaults(lang, level) {
  const L = lang.levels[level];
  return { target_word_count: round50(L.words), max_sentence_length: L.maxWords, new_words_per_article: L.newWords[1] };
}
const LEVEL_BOUND = { target_word_count: [100, 500], max_sentence_length: [8, 30], new_words_per_article: [0, 25] };

const cleanList = v => (Array.isArray(v) ? [...new Set(v.map(x => String(x).trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, 10) : null);

/** Stored settings → the full config the app reads (shape of the Japanese /api/config). */
function toConfig(lang, stored = {}) {
  const level = LEVELS.includes(stored.proficiency_level) ? stored.proficiency_level : 'A1-A2';
  const d = levelDefaults(lang, level);
  const bound = k => (Number.isFinite(stored[k]) ? clamp(Math.round(stored[k]), ...LEVEL_BOUND[k]) : d[k]);
  return {
    proficiency_level: level,
    max_sentence_length: bound('max_sentence_length'),
    new_words_per_article: bound('new_words_per_article'),
    target_word_count: bound('target_word_count'),
    reuse_ratio: Number.isFinite(stored.reuse_ratio) ? clamp(stored.reuse_ratio, 0.3, 0.9) : 0.65,
    topics: cleanList(stored.topics) || DEFAULT_TOPICS,
    regions: cleanList(stored.regions) || [],
    news_timeframe_hours: Number.isFinite(stored.news_timeframe_hours) ? clamp(Math.round(stored.news_timeframe_hours), 12, 168) : 168,
    enabled_sources: [], excluded_sources: [], include_podcasts: false,
    quiz_questions_count: Number.isFinite(stored.quiz_questions_count) ? clamp(Math.round(stored.quiz_questions_count), 3, 15) : 6,
    writing_system: 'romaji', // no scripts to choose from; the app hides the choice
    auto_generate: false, auto_generate_interval_hours: 24,
  };
}

/**
 * Merge what the settings screen sent into the stored settings.
 * A level-bound value that still equals what the screen showed for the old
 * level (or the default of the new level) stays automatic.
 * @returns {{stored: object, errors: string[]}}
 */
function applyUpdate(lang, stored = {}, updates = {}) {
  const out = { ...stored };
  const errors = [];
  const shown = toConfig(lang, stored);
  if (updates.proficiency_level !== undefined) {
    if (LEVELS.includes(updates.proficiency_level)) out.proficiency_level = updates.proficiency_level;
    else errors.push(`Unknown level: ${updates.proficiency_level}`);
  }
  const fresh = levelDefaults(lang, LEVELS.includes(out.proficiency_level) ? out.proficiency_level : 'A1-A2');
  for (const k of Object.keys(LEVEL_BOUND)) {
    if (updates[k] === undefined) continue;
    const n = Number(updates[k]);
    if (!Number.isFinite(n)) { errors.push(`${k} must be a number`); continue; }
    const untouched = !Number.isFinite(stored[k]) && (n === shown[k] || n === fresh[k]);
    if (untouched) delete out[k]; else out[k] = clamp(Math.round(n), ...LEVEL_BOUND[k]);
  }
  for (const k of ['reuse_ratio', 'news_timeframe_hours', 'quiz_questions_count']) {
    if (updates[k] === undefined) continue;
    const n = Number(updates[k]);
    if (Number.isFinite(n)) out[k] = n; else errors.push(`${k} must be a number`);
  }
  for (const k of ['topics', 'regions']) {
    if (updates[k] === undefined) continue;
    const list = cleanList(updates[k]);
    if (list) out[k] = list; else errors.push(`${k} must be a list`);
  }
  // writing_system and the other Japanese-only keys are accepted and ignored
  return { stored: out, errors };
}

/**
 * What one article is written with. `request` is what the "New Article" form
 * sent (same keys as the Japanese form); a value the form merely passed on
 * from the settings does not count as a wish.
 */
function effective(lang, stored = {}, request = {}) {
  const shown = toConfig(lang, stored);
  const level = LEVELS.includes(request.proficiency_level) ? request.proficiency_level : shown.proficiency_level;
  const L = lang.levels[level];
  const wish = k => {
    const n = Number(request[k]);
    if (request[k] !== undefined && request[k] !== null && Number.isFinite(n) && n !== shown[k]) return clamp(Math.round(n), ...LEVEL_BOUND[k]);
    return Number.isFinite(stored[k]) ? shown[k] : null; // null = follow the level
  };
  const words = wish('target_word_count');
  const maxWords = wish('max_sentence_length');
  const newWords = wish('new_words_per_article');
  const noNew = newWords === 0;
  return {
    level,
    topics: shown.topics,
    regions: shown.regions,
    // the longest choice (7 days) keeps the 10-day window the search was tuned with
    days: shown.news_timeframe_hours >= 168 ? 10 : Math.max(1, Math.ceil(shown.news_timeframe_hours / 24)),
    rules: {
      words: words === null ? L.words : words,
      maxWords: maxWords === null ? L.maxWords : maxWords,
      newWords: newWords === null ? L.newWords : noNew ? [0, 0] : [Math.max(1, newWords - 3), newWords],
      quizCount: shown.quiz_questions_count,
      // more words from earlier articles when the learner wants more reuse, and when there are no new words
      reviewCount: clamp(Math.round(shown.reuse_ratio * 5), 1, 5) + (noNew ? 4 : 0),
    },
  };
}

module.exports = { toConfig, applyUpdate, effective, levelDefaults, LEVELS, DEFAULT_TOPICS };
