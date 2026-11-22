// German / English data in the shape of the Japanese API.
//
// From app 1.6 on, German and English use the SAME screens as Japanese. Those
// screens read the Japanese field names (title_romaji, meaning_en, ...), so
// for them the server answers in that shape. The stored data keeps its own
// neutral names; this file only translates on the way out.
//   word_romaji_macron  the dictionary form ("die Regierung, -en")
//   word_romaji         the word as written in the text ("Regierung")
//   meaning_en          the meaning (Japanese — the learner's language)
//   jlpt_level          the word's level (A1-A2 / B1 / B2 / C1+)
// Pure functions — tested in test/multilang-shape.test.js.

const { answerParts } = require('./learn');
const { LEVELS } = require('./settings');

/** Level of a word from the word list of its language, or null without the data. */
function wordLevel(lookup, base) {
  if (!lookup) return null;
  const head = (answerParts(base).headword.match(/[\p{L}][\p{L}'’-]*/u) || [''])[0];
  if (!head) return null;
  for (const level of LEVELS) if (lookup.known(head, level)) return level;
  return 'C1+';
}

/** A word of the learner's list. */
function word(w, lookup) {
  const example = [w.example, w.example_translation].filter(Boolean).join('\n');
  return {
    id: w.num_id,
    word_romaji: answerParts(w.base).headword,
    word_romaji_macron: w.base,
    word_kanji: null, word_kana: null,
    meaning_en: w.meaning || '',
    part_of_speech: w.pos || null,
    jlpt_level: wordLevel(lookup, w.base),
    category: null,
    status: w.status || 'new',
    times_seen: w.times_seen || 0,
    times_used_correctly: w.times_used_correctly || 0,
    times_tested: w.times_tested || 0,
    times_tested_correct: w.times_tested_correct || 0,
    streak_correct: w.streak_correct || 0,
    first_seen_at: w.created_at || null,
    last_seen_at: w.last_seen_at || null,
    last_tested_at: w.last_tested_at || null,
    next_review_at: w.next_review_at || null,
    first_seen_in_article_id: w.first_article_id || null,
    context_sentence: example || null,
  };
}

/** The words of one article, joined with the learner's list (id, status, counters). */
function articleWords(a, mine, lookup) {
  const byBase = new Map(mine.map(w => [String(w.base).toLowerCase(), w]));
  let missing = 0;
  const one = (v, flags) => {
    const hit = byBase.get(String(v.base).toLowerCase());
    // a word the learner deleted from the list still shows in the article; it gets a
    // negative id that no stored word has
    const base = hit ? word(hit, lookup) : { ...word({ ...v, status: 'new' }, lookup), id: -(++missing) };
    const example = [v.example, v.example_translation].filter(Boolean).join('\n');
    return { ...base, word_romaji: v.word || base.word_romaji, meaning_en: v.meaning || base.meaning_en, context_sentence: example || base.context_sentence, ...flags };
  };
  return [
    ...(a.vocabulary || []).map(v => one(v, { is_new: 1, is_review: 0 })),
    ...(a.review_vocabulary || []).map(v => one(v, { is_new: 0, is_review: 1 })),
  ];
}

const paragraphs = body => String(body || '').split(/\n+/).map(p => p.trim()).filter(Boolean).join('\n\n');

/** An article in a list (no body). */
function articleItem(a) {
  return {
    id: a.id, title_romaji: a.title, summary_romaji: a.summary || null,
    // the stored topic is the news in one English sentence (for the search); the card shows the short category
    topic: a.category || null, region: a.region || null,
    word_count: a.word_count || 0, new_word_count: a.new_word_count || 0,
    review_word_count: a.review_word_count !== undefined ? a.review_word_count : (a.review_vocabulary || []).length,
    created_at: a.created_at || null, read_at: a.read_at || null, quiz_completed_at: a.quiz_completed_at || null,
    quiz_score: typeof a.quiz_score === 'number' ? a.quiz_score / 100 : null, // stored 0-100, the app reads 0-1
    writing_system: 'romaji',
  };
}

/** A full article. */
function article(a, mine, lookup) {
  const g = a.grammar_note;
  return {
    ...articleItem(a),
    body_romaji: paragraphs(a.body),
    translation_en: a.translation || null,
    grammar_points: g && g.point ? [{ pattern: g.point, level: a.level || '', explanation: g.explanation, examples: g.sentence ? [g.sentence] : [] }] : [],
    sources: (a.sources || []).map(s => ({ name: s.source || s.title || '', url: s.url || null })),
    vocabulary: articleWords(a, mine, lookup),
  };
}

/** Quiz questions; ids are the position in the article's quiz, starting at 1. */
function quizQuestions(a) {
  return (a.quiz || []).map((q, i) => ({
    id: i + 1, article_id: a.id, type: q.type || 'comprehension',
    question_romaji: q.question, question_en: q.instruction || null,
    correct_answer: q.options[q.answer_index],
    distractors: q.options.filter((_, k) => k !== q.answer_index),
    hint: q.explanation || null, vocabulary_id: null,
  }));
}

/** [{question_id, answer}] (answer = the option's text) → the chosen option per question, -1 = none. */
function quizAnswers(a, answers) {
  const chosen = (a.quiz || []).map(() => -1);
  for (const { question_id: id, answer } of Array.isArray(answers) ? answers : []) {
    const q = (a.quiz || [])[id - 1];
    if (!q) continue;
    chosen[id - 1] = q.options.findIndex(o => String(o).trim().toLowerCase() === String(answer || '').trim().toLowerCase());
  }
  return chosen;
}

/** Statistics with the recall / multiple-choice split and the words per level. */
function stats(base, words, lookup) {
  const sum = k => words.reduce((n, w) => n + (w[k] || 0), 0);
  const recalled = sum('times_recalled'), recalledCorrect = sum('times_recalled_correct');
  const tested = sum('times_tested'), testedCorrect = sum('times_tested_correct');
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  const levels = {};
  for (const w of words) { const l = wordLevel(lookup, w.base); if (l) levels[l] = (levels[l] || 0) + 1; }
  const order = [...LEVELS, 'C1+'];
  return {
    ...base,
    vocabulary: {
      ...base.vocabulary,
      byLevel: order.filter(l => levels[l]).map(l => ({ jlpt_level: l, count: levels[l] })),
      recall: { tested: recalled, correct: recalledCorrect, percent: pct(recalledCorrect, recalled) },
      choice: { tested: tested - recalled, correct: testedCorrect - recalledCorrect, percent: pct(testedCorrect - recalledCorrect, tested - recalled) },
    },
  };
}

/** Other words of the learner with the same meaning — also right answers in a typed review. */
function alsoAccept(reviewWords, all) {
  const senses = w => String(w.meaning || '').replace(/[（(][^)）]*[)）]/g, '').split(/[,;/、；・]/).map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const w of reviewWords) {
    const mine = new Set(senses(w));
    const others = all.filter(o => o.num_id !== w.num_id && senses(o).some(s => mine.has(s))).map(o => o.base);
    if (others.length) out[w.num_id] = [...new Set(others)];
  }
  return out;
}

module.exports = { word, article, articleItem, quizQuestions, quizAnswers, stats, alsoAccept, wordLevel };
