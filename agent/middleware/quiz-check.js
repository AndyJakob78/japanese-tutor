// Quiz giveaway check
// Finds quiz questions whose right answer can be guessed without knowing the
// word: options in mixed languages, one answer much longer than the others,
// a hint or English line that contains the answer, too many "meaning" questions.
// The pipeline sends the problems back to Claude once to fix (see generateQuiz).

const MAX_MEANING = 2;

// One Hepburn syllable: optional consonant(s) + vowel, a lone n, or the first
// half of a doubled consonant (kk, tt, tch, pp, ss).
const ROMAJI_WORD = /^(?:(?:[kgsztdnhbpmrfj]y?|ch|sh|ts|w|y|v)?[aiueoāīūēō]|n'|n(?![aiueoyāīūēō])|[kgstpc](?=[kgstpc]))+$/;

function words(text) {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')            // "Election (hito ga erabu koto)" → judge "Election"
    .toLowerCase()
    .split(/[^a-zāīūēō']+/)
    .filter(w => w.length > 0);
}

// Letter pairs Hepburn never writes (it uses chi, tsu, shi, fu, ji…)
const NOT_HEPBURN = /ti|tu|si|(?<![sc])hu|zi|di|du|wi|wu|we|yi|ye|[lqx]|c(?!h)/;
// English words that settle it: "To decide", "the president of a country"
const ENGLISH_WORD = /^(?:the|an?|of|is|are|was|and|or|because|for|with|very|not|by|from|this|that|it|its|their|people)$/;

const isRomajiWord = w => !NOT_HEPBURN.test(w) && ROMAJI_WORD.test(w);

/** 'ja' (romaji), 'en', or null when it can't tell (empty, single ambiguous word). */
function optionLanguage(text) {
  const ws = words(text);
  if (ws.length === 0) return null;
  if ((ws[0] === 'to' && ws.length > 1) || ws.some(w => ENGLISH_WORD.test(w))) return 'en';
  const ja = ws.filter(isRomajiWord).length / ws.length;
  if (ja >= 0.75) return 'ja';
  if (ja <= 0.5) return 'en';
  return null;
}

function contains(haystack, needle) {
  const n = String(needle || '').trim().toLowerCase().replace(/[.!?。]+$/, '');
  if (n.length < 3) return false;
  return String(haystack || '').toLowerCase().includes(n);
}

/**
 * @param {object[]} questions - quiz questions as generated
 * @param {{ reviewWords?: string[] }} expected - older words that need a "review" question
 * @returns {{ quiz: string[], byQuestion: Map<number, string[]> }} problems found
 */
function findGiveaways(questions, expected = {}) {
  const byQuestion = new Map();
  const quiz = [];
  const add = (i, msg) => {
    if (!byQuestion.has(i)) byQuestion.set(i, []);
    byQuestion.get(i).push(msg);
  };

  (questions || []).forEach((q, i) => {
    const answer = String(q.correct_answer || '').trim();
    const distractors = Array.isArray(q.distractors) ? q.distractors.map(d => String(d).trim()) : [];
    const options = [answer, ...distractors];

    if (distractors.length !== 3) add(i, `needs exactly 3 distractors (has ${distractors.length})`);
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) add(i, 'two options are the same');

    // One-word comprehension answers are usually names (Commerzbank / Pōrando) — no language to compare
    const namesOnly = q.type === 'comprehension' && options.every(o => !/\s/.test(o));
    const langs = new Set(options.map(optionLanguage).filter(Boolean));
    if (langs.size > 1 && !namesOnly) add(i, 'options mix English and Japanese — make all 4 the same language');

    const longest = Math.max(...distractors.map(d => d.length), 0);
    if (distractors.length && answer.length >= longest * 1.6 && answer.length - longest >= 8) {
      add(i, `correct answer is much longer than the distractors (${answer.length} vs ≤${longest} chars)`);
    }
    const hasExtra = s => /[,(]/.test(s);
    if (hasExtra(answer) && !distractors.some(hasExtra)) {
      add(i, 'only the correct answer has a comma or brackets ("Last, final") — give all options the same form');
    }

    const lowerOptions = options.map(o => o.toLowerCase());
    if (q.type === 'particle' && lowerOptions.includes('wa') && lowerOptions.includes('ga')) {
      add(i, 'particle options include both "wa" and "ga" — both usually fit; replace one with another particle');
    }

    // A one-word answer printed in the stem ("'Hantai' wa nihongo de nan desu ka?" → hantai)
    if (!/\s/.test(answer) && answer.length >= 3 && q.type !== 'meaning'
      && new RegExp(`(^|[^a-zāīūēō])${answer.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-zāīūēō])`).test(String(q.question_romaji || '').toLowerCase())) {
      add(i, 'the question itself contains the correct answer');
    }

    if (contains(q.hint, answer)) add(i, 'hint contains the correct answer');
    if (contains(q.question_en, answer)) add(i, 'question_en contains the correct answer');
  });

  const meaning = (questions || []).filter(q => q.type === 'meaning').length;
  if (meaning > MAX_MEANING) {
    quiz.push(`${meaning} "meaning" questions — at most ${MAX_MEANING}; turn the others into reverse / context / particle questions`);
  }
  if ((questions || []).length >= 5 && !(questions || []).some(q => q.type === 'particle')) {
    quiz.push('no "particle" question — turn one question into a particle question');
  }
  const wordTests = new Map();
  (questions || []).forEach((q, i) => {
    if (!['meaning', 'reverse', 'context'].includes(q.type) || !q.vocabulary_word) return;
    const w = String(q.vocabulary_word).toLowerCase();
    wordTests.set(w, [...(wordTests.get(w) || []), i + 1]);
  });
  for (const [w, nums] of wordTests) {
    if (nums.length > 1) quiz.push(`"${w}" is tested by questions ${nums.join(' and ')} — use a different [NEW] word in one of them`);
  }

  for (const word of expected.reviewWords || []) {
    const tested = (questions || []).some(q => q.type === 'review'
      && String(q.vocabulary_word || '').toLowerCase() === word.toLowerCase());
    if (!tested) quiz.push(`no "review" question for the older word "${word}" (vocabulary_word must be "${word}")`);
  }

  return { quiz, byQuestion };
}

function countProblems({ quiz, byQuestion }) {
  let n = quiz.length;
  for (const list of byQuestion.values()) n += list.length;
  return n;
}

/** Problems as a numbered list for the fix prompt. */
function describeProblems(found, questions) {
  const lines = [...found.quiz.map(p => `- Whole quiz: ${p}`)];
  for (const [i, list] of found.byQuestion) {
    const stem = String(questions[i]?.question_romaji || '').slice(0, 60);
    lines.push(`- Question ${i + 1} ("${stem}"): ${list.join('; ')}`);
  }
  return lines.join('\n');
}

module.exports = { findGiveaways, countProblems, describeProblems, _internals: { optionLanguage, ROMAJI_WORD } };
