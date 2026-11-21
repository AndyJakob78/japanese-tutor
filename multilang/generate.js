// German / English article pipeline (prototype, 2026-11-21).
// Same chain as the Japanese pipeline, without script conversion:
//   news search → writer (article + translation + vocabulary, one call)
//   → code check → reviewer (one call, gets the code-check findings)
//   → code check again → quiz (one call) → quiz check.
// Nothing here reads or writes the database.

const { callClaudeJSON, callClaudeSearchJSON } = require('../server/services/claude');
const { lintArticle, formatForReviewer, summarize, tidy, syncGrammarNote, cleanQuiz, checkQuiz } = require('./lint');
const P = require('./prompts');
const wordlevel = require('./wordlevel');
const { answerParts: learnParts } = require('./learn');

const LANGS = { de: require('./languages/de'), en: require('./languages/en') };
const secs = t => Math.round((Date.now() - t) / 100) / 10;

async function searchNews(langKey, topicHint, recentTopics = [], level = 'B1') {
  const { system, user } = P.searchPrompts(LANGS[langKey], topicHint, recentTopics, level);
  // A story with too few facts makes the writer pad or invent — try once more.
  let news;
  // Third try: drop the topic wish — any good story beats no article.
  const open = P.searchPrompts(LANGS[langKey], '', recentTopics, level).user;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      news = await callClaudeSearchJSON(system, attempt === 1 ? user : `${attempt === 2 ? user : open}\nThe last result had too few facts. Pick a story whose article text you can read, and give 6-10 facts.`, { max_searches: 16, max_tokens: 8192 }); // one search pass uses several queries; 8 ran out for German (2026-11-21), ~$0.01 each
    } catch (e) { console.log(`[search ${langKey}] no usable answer (attempt ${attempt}): ${e.message.slice(0, 120)}`); continue; }
    const facts = (news.articles || []).reduce((n, a) => n + (a.keyFacts || []).length, 0);
    if (facts >= 6) return news;
    console.log(`[search ${langKey}] only ${facts} facts (attempt ${attempt}): ${JSON.stringify(news).slice(0, 400)}`);
  }
  throw new Error('news search found no story with enough facts');
}

function applyReview(article, r) {
  const out = { ...article };
  for (const k of ['title', 'summary', 'body']) if (typeof r[k] === 'string' && r[k].trim()) out[k] = r[k];
  if (typeof r.translation_ja === 'string' && r.translation_ja.trim()) out.translation_ja = r.translation_ja;
  for (const fix of Array.isArray(r.vocab_fixes) ? r.vocab_fixes : []) {
    const v = (out.vocabulary || []).find(x => String(x.word).toLowerCase() === String(fix.word || '').toLowerCase());
    if (!v) continue;
    for (const k of ['base', 'pos', 'meaning_ja', 'example', 'example_ja']) if (typeof fix[k] === 'string' && fix[k].trim()) v[k] = fix[k];
  }
  for (const add of Array.isArray(r.vocab_add) ? r.vocab_add : []) {
    if (!add || !add.word || !add.meaning_ja) continue;
    if (!(out.vocabulary || []).some(x => String(x.word).toLowerCase() === String(add.word).toLowerCase())) out.vocabulary = [...(out.vocabulary || []), add];
  }
  return out;
}

/**
 * Generate one article. Returns the article plus timings and check results.
 * @param {'de'|'en'} langKey
 * @param {'A1-A2'|'B1'|'B2'} level
 * @param {object} news  output of searchNews()
 * @param {{knownWords?: string[], reviewWords?: object[], weakSpots?: object[]}} [opts]
 *   knownWords: words the learner met before; reviewWords: words to bring back
 *   ([REVIEW]); weakSpots: mistake patterns from sentence practice
 */
async function generate(langKey, level, news, opts = {}) {
  const lang = LANGS[langKey];
  if (!lang || !lang.levels[level]) throw new Error(`unknown language/level: ${langKey} ${level}`);
  const timings = {};
  const knownWords = (opts.knownWords || []).filter(Boolean);
  const names = wordlevel.namesFrom(news, { everyWord: langKey !== 'en' });
  // a word the learner already met is not "hard" any more
  for (const w of knownWords) for (const part of String(w).toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || []) names.add(part);
  const extra = { words: wordlevel.load(lang), names };
  const tag = `[${langKey} ${level}]`;

  let t = Date.now();
  const reviewWords = (opts.reviewWords || []).slice(0, 3);
  const w = P.writerPrompts(lang, level, news, knownWords, { reviewWords, weakSpots: opts.weakSpots });
  let article = tidy(await callClaudeJSON(w.system, w.user, { max_tokens: 6144 }));
  const draft = { title: article.title, body: article.body };
  // which review words really made it into the text
  const usedReview = () => reviewWords.filter(rw => new RegExp(`\\[REVIEW\\]\\s*${learnParts(rw.base).headword.slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(article.body));
  timings.writer = secs(t);

  const lintBefore = lintArticle(article, lang, level, extra);
  console.log(`${tag} writer ${timings.writer}s, code check found ${lintBefore.length}`);

  t = Date.now();
  const r = P.reviewerPrompts(lang, level, article, news, formatForReviewer(lintBefore));
  const review = await callClaudeJSON(r.system, r.user, { max_tokens: 6144 });
  article = syncGrammarNote(tidy(applyReview(article, review)), lang);
  timings.reviewer = secs(t);

  article.review_vocabulary = usedReview();
  const lintAfter = lintArticle(article, lang, level, extra);
  console.log(`${tag} reviewer ${timings.reviewer}s, ${(review.fixes_made || []).length} fixes, code check left ${lintAfter.length}`);

  t = Date.now();
  const q = P.quizPrompts(lang, level, article);
  let quiz = cleanQuiz(await callClaudeJSON(q.system, q.user, { max_tokens: 4096 }));
  let quizProblems = checkQuiz(quiz);
  if (quizProblems.length) {
    // Only when the code check finds a problem: one repair call (costs time only then).
    console.log(`${tag} quiz problems, one repair: ${quizProblems.join('; ')}`);
    try {
      const fixed = cleanQuiz(await callClaudeJSON(q.system, `${q.user}\n\nYour last quiz:\n${JSON.stringify(quiz)}\n\nA program found these problems — return the full corrected quiz:\n- ${quizProblems.join('\n- ')}`, { max_tokens: 4096 }));
      const left = checkQuiz(fixed);
      if (left.length < quizProblems.length) { quiz = fixed; quizProblems = left; }
    } catch (e) { console.log(`${tag} quiz repair failed: ${e.message.slice(0, 80)}`); }
  }
  timings.quiz = secs(t);
  timings.total = Math.round((timings.writer + timings.reviewer + timings.quiz) * 10) / 10;
  console.log(`${tag} quiz ${timings.quiz}s, ${quizProblems.length} problems — total ${timings.total}s`);

  return {
    language: langKey, level, topic: news.topic, ...article, quiz: quiz.questions || [],
    sources: (news.articles || []).map(a => ({ title: a.headline, source: a.source, url: a.url })),
    _draft: draft,
    _lint_before: summarize(lintBefore),
    _reviewer_fixes: review.fixes_made || [],
    lint_warnings: summarize(lintAfter),
    _quiz_problems: quizProblems,
    _timings: timings,
  };
}

module.exports = { generate, searchNews, LANGS };
