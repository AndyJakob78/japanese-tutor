// Code check for German and English articles — the same idea as
// agent/middleware/article-lint.js for Japanese: plain string checks that
// cost no Claude call. It runs before the reviewer (the findings go into the
// reviewer call as a must-fix list) and again after it (leftovers are kept
// as lint_warnings).

const { stripMarkers, hasJapanese } = require('./util');

const ABBREVIATIONS = /(?<![\p{L}])(?:z\. ?B|u\. ?a|d\. ?h|usw|bzw|ca|Dr|Prof|Nr|St|Mio|Mrd|Mr|Mrs|Ms|U\.S|U\.K|e\.g|i\.e|vs|Inc|Co|Ltd|Jan|Feb|Aug|Sept|Okt|Oct|Nov|Dez|Dec)\./gu;

/** Split text into sentences (markers removed). */
function splitSentences(text, lang) {
  let t = stripMarkers(text).replace(ABBREVIATIONS, m => m.replace(/\./g, '\u0001'));
  // German ordinals and dates: "am 21. November" is not a sentence end
  // (only after an article or preposition, so "2016/17. Computer ..." still splits)
  if (!lang.splitAfterShortNumber) t = t.replace(/(?<=(?:^|\s)(?:am|vom|zum|bis|ab|seit|im|beim|der|die|das|den|dem|des|jeden|diesem)\s)(\d{1,2})\.(?=\s)/giu, '$1\u0001');
  return t.split(/\n+|(?<=[.!?]["“”»]?)\s+/u).map(s => s.replace(/\u0001/g, '.').trim()).filter(Boolean);
}

const wordCount = s => s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

function contentStems(sentence, lang) {
  const out = new Set();
  const tokens = sentence.match(/[\p{L}]{4,}/gu) || [];
  tokens.forEach((tok, i) => {
    if (lang.skipCapitalizedInRepeats && i > 0 && /^\p{Lu}/u.test(tok)) return; // a name
    const stem = tok.toLowerCase().slice(0, 5);
    if (!lang.stop.has(stem)) out.add(stem);
  });
  return out;
}

/** Pairs of sentences that say nearly the same thing. */
function findRepeats(sentences, lang) {
  const sets = sentences.map(s => contentStems(s, lang));
  const out = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const [small, big] = sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
      if (small.size < 4) continue;
      const shared = [...small].filter(w => big.has(w)).length;
      if (shared / small.size >= 0.75) out.push([sentences[i], sentences[j]]);
    }
  }
  return out;
}

/** Words the writer marked as new: "[NEW] Regierung" -> "Regierung". */
function markedWords(body) {
  return [...String(body || '').matchAll(/\[NEW\]\s*([\p{L}][\p{L}'’-]*)/gu)].map(m => m[1]);
}

/**
 * Check an article. Returns [{ rule, quote, hint }].
 * @param {{title, summary, body, translation_ja, vocabulary}} article
 * @param {object} lang  a file from ./languages
 * @param {string} level 'A1-A2' | 'B1' | 'B2'
 * @param {{words?: {known: Function}, names?: Set<string>}} [extra]  word-level data (./wordlevel.js)
 */
function lintArticle(article, lang, level, extra = {}) {
  const L = lang.levels[level];
  const findings = [];
  const seen = new Map();
  const add = (rule, quote, hint) => {
    const n = (seen.get(rule + hint) || 0) + 1;
    seen.set(rule + hint, n);
    if (n <= 3 || rule === 'hard-word') findings.push({ rule, quote: String(quote).trim().slice(0, 180), hint });
  };

  const body = stripMarkers(article.body);
  if (hasJapanese([article.title, article.summary, body].join(' '))) add('script', 'Japanese characters in the article', `the article text must be ${lang.name} only`);

  const sentences = splitSentences(article.body, lang);
  for (const s of sentences) {
    const n = wordCount(s);
    if (n > L.maxWords) add('long-sentence', s, `${n} words — the limit at ${level} is ${L.maxWords}; split it into two sentences`);
    const subs = (s.match(lang.subordinators) || []).length;
    if (subs > L.maxSub) add('nested', s, `${subs} subordinate clauses — at ${level} at most ${L.maxSub} per sentence; split it`);
    if (lang.fragmentRe.test(s)) add('fragment', s, 'not a full sentence (a subordinate clause on its own) — join it to the sentence before');
    for (const p of lang.phrases) {
      if (p.levels && !p.levels.includes(level)) continue;
      const m = s.match(p.re);
      if (m) add(p.rule, `${m[0].trim()}  ←  ${s}`, p.hint);
    }
  }
  const total = wordCount(body);
  if (total > L.words * 1.3) add('too-long', `${total} words`, `the target at ${level} is about ${L.words} words — delete the least important sentences (background first), do not shorten by cramming`);
  for (const [a, b] of findRepeats(sentences, lang)) {
    add('repeat', `${a}  ⇄  ${b}`, 'possible repetition — if both sentences give the same fact, keep one; if they are two different facts, leave both');
  }

  // New-word markers and the vocabulary list must match
  const vocab = Array.isArray(article.vocabulary) ? article.vocabulary : [];
  const marked = markedWords(article.body).map(w => w.toLowerCase());
  const [minNew, maxNew] = L.newWords;
  if (marked.length > maxNew) add('too-many-new', `${marked.length} words marked [NEW]`, `at ${level} at most ${maxNew} new words — replace the least important ones with easier words`);
  if (marked.length < minNew && article.vocabulary) add('too-few-new', `${marked.length} words marked [NEW]`, `mark the ${minNew}-${maxNew} hardest words with [NEW]`);
  for (const v of vocab) {
    const first = String(v.word || '').split(/\s+/)[0].toLowerCase();
    if (!marked.includes(first)) add('vocab-mismatch', v.word, 'this vocabulary word is not marked [NEW] in the body');
    if (!hasJapanese(v.meaning_ja)) add('vocab-meaning', v.word, 'the meaning must be in Japanese');
    const hint = lang.checkVocab(v);
    if (hint) add('vocab-form', v.word, hint);
  }

  // Hard words that are not marked: needs the word-level data, skipped without it
  if (extra.words) {
    const skip = new Set([...marked, ...vocab.flatMap(v => String(v.word || '').toLowerCase().split(/\s+/))]);
    const names = extra.names || new Set();
    const hard = new Set();
    for (const s of sentences) {
      const tokens = s.match(/[\p{L}][\p{L}'’-]*/gu) || [];
      tokens.forEach((tok, i) => {
        const w = tok.toLowerCase().replace(/['’]s$/, '');
        if (w.length < 3 || skip.has(w) || names.has(w) || names.has(w.replace(/e?s$/, '')) || hard.has(w)) return;
        // another form of a word that is already marked ("Schaltsekunden")
        if ([...skip].some(m => m.length >= 5 && w.length >= 5 && (w.startsWith(m.slice(0, Math.max(5, m.length - 2))) || m.startsWith(w.slice(0, Math.max(5, w.length - 2)))))) return;
        if (lang.skipCapitalizedInRepeats && i > 0 && /^\p{Lu}/u.test(tok)) return; // a name inside an English sentence
        if (!extra.words.known(w, level)) hard.add(w);
      });
    }
    const room = Math.max(0, maxNew - marked.length);
    [...hard].slice(0, 8).forEach(w => add('hard-word', w, `above ${level} and not marked — use an easier word. Only if no easier word exists: keep it, mark it [NEW] and add it to "vocab_add" (room for ${room} more new words)`));
    if (hard.size > 8) add('hard-word', `${hard.size - 8} more words above ${level}`, 'simplify the vocabulary');
  }

  if (article.translation_ja !== undefined) {
    if (!hasJapanese(article.translation_ja)) add('translation', 'translation_ja', 'the translation must be in Japanese');
    else {
      const ja = String(article.translation_ja).split(/(?<=[。！？])/u).filter(s => s.trim()).length;
      // Japanese may split or join sentences; only a big gap means something is missing or added
      if (ja < sentences.length * 0.7 || ja > sentences.length * 1.5) add('translation', `${sentences.length} sentences in the article, ${ja} in the translation`, 'the translation seems to leave something out or add something — translate every sentence, nothing more');
    }
  }
  return findings;
}

/** The block that is added to the reviewer prompt. '' when nothing was found. */
function formatForReviewer(findings) {
  // warnings only: the reviewer cannot add vocabulary entries, and cutting a whole
  // article to length makes the reviewer call slow — the writer has to hit the length
  findings = findings.filter(f => f.rule !== 'too-few-new' && f.rule !== 'too-long');
  if (!findings.length) return '';
  return '## 🔎 CODE CHECK — fix every item below (found by a program, not a guess)\n' +
    findings.slice(0, 14).map((f, i) => `${i + 1}. [${f.rule}] ${f.quote}\n   → ${f.hint}`).join('\n');
}

const summarize = findings => findings.map(f => `${f.rule}: ${f.quote}`);

/**
 * Repairs that need no judgement: marker spacing, vocabulary entries whose
 * word is no longer marked, markers that have no vocabulary entry.
 */
function tidy(article) {
  const a = { ...article };
  a.body = String(a.body || '').replace(/\[NEW\]\s*/g, '[NEW] ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  if (Array.isArray(a.vocabulary)) {
    const marked = markedWords(a.body).map(w => w.toLowerCase());
    // one entry per dictionary form ("astronomische" and "astronomischen" are one word)
    const bases = new Set();
    a.vocabulary = a.vocabulary.filter(v => { const b = String(v.base || v.word).toLowerCase(); if (bases.has(b)) return false; bases.add(b); return true; });
    a.vocabulary = a.vocabulary.filter(v => marked.includes(String(v.word || '').split(/\s+/)[0].toLowerCase()));
    const known = new Set(a.vocabulary.map(v => String(v.word || '').split(/\s+/)[0].toLowerCase()));
    a.body = a.body.replace(/\[NEW\] ([\p{L}][\p{L}'’-]*)/gu, (m, w) => (known.has(w.toLowerCase()) ? m : w));
  }
  a.word_count = wordCount(stripMarkers(a.body));
  return a;
}

/** After the reviewer changed the body, point the grammar note at the sentence as it reads now. */
function syncGrammarNote(article, lang) {
  const g = article.grammar_note;
  if (!g || !g.sentence) return article;
  const sentences = splitSentences(article.body, lang);
  const want = new Set(stripMarkers(g.sentence).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  let best = null, bestScore = 0;
  for (const s of sentences) {
    const toks = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const score = toks.filter(t => want.has(t)).length / Math.max(want.size, toks.length, 1);
    if (score > bestScore) { best = s; bestScore = score; }
  }
  if (best && bestScore >= 0.6) return { ...article, grammar_note: { ...g, sentence: best } };
  return { ...article, grammar_note: null }; // the sentence was removed — no note is better than a wrong one
}

/** The quiz must never show the [NEW] markers. */
function cleanQuiz(quiz) {
  const qs = ((quiz && quiz.questions) || []).map(q => ({
    ...q,
    question: stripMarkers(q.question),
    options: (q.options || []).map(o => stripMarkers(o)),
    explanation_ja: stripMarkers(q.explanation_ja),
  }));
  return { questions: qs };
}

/** Plain checks on the quiz. Returns a list of problems (strings). */
function checkQuiz(quiz) {
  const problems = [];
  const qs = (quiz && quiz.questions) || [];
  if (qs.length < 6) problems.push(`only ${qs.length} questions (6 are needed)`);
  qs.forEach((q, i) => {
    const o = q.options || [];
    if (o.length !== 4 || new Set(o.map(x => String(x).trim().toLowerCase())).size !== 4) problems.push(`Q${i + 1}: needs four different options`);
    if (!(Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < o.length)) problems.push(`Q${i + 1}: answer_index out of range`);
    else {
      const lens = o.map(x => String(x).length);
      const right = lens[q.answer_index];
      const others = lens.filter((_, k) => k !== q.answer_index);
      if (right > Math.max(...others) * 1.6 && right - Math.max(...others) > 12) problems.push(`Q${i + 1}: the right answer is much longer than the others (gives it away)`);
    }
    if (!hasJapanese(q.instruction_ja) || !hasJapanese(q.explanation_ja)) problems.push(`Q${i + 1}: instruction and explanation must be in Japanese`);
  });
  return problems;
}

module.exports = { lintArticle, formatForReviewer, summarize, tidy, syncGrammarNote, cleanQuiz, checkQuiz, splitSentences, markedWords, wordCount, _internals: { findRepeats } };
