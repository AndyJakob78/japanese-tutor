// English for Japanese-speaking learners. Same structure as de.js.

const { words } = require('../util');

const BEGINNER = ['A1-A2'];
const UP_TO_B1 = ['A1-A2', 'B1'];

const PP = '(?:been|\\p{L}+ed|gone|done|seen|made|taken|given|said|told|known|become|begun|come|found|left|lost|won|written|risen|fallen|grown|built|sold|held|shown|sent|paid)';

module.exports = {
  key: 'en',
  name: 'English',
  nativeName: 'English',
  newsRegion: 'the English-speaking world or international news',
  levels: {
    'A1-A2': {
      words: 110, maxWords: 14, maxSub: 1, newWords: [4, 8],
      rules: `- Tenses: present simple, present continuous, past simple, "will" / "be going to". Present perfect only for fresh news ("has opened"), and rarely.
- Modal verbs: can, could (past ability), must, have to, should, may.
- Sentences: 6-12 words, never more than 14. Join ideas with and, but, or, so, then.
- Subordinate clauses: only "because", "when", "if" (with present + will) and "that" after say / think / know; at most ONE per sentence.
- Passive: only the simple form and only when nobody knows who did it ("He was arrested."). At most twice in the article.
- NOT allowed: past perfect ("had gone"), perfect continuous, "would" (only "would like"), second and third conditional, although / though / despite / however / therefore / unless / whether / while (for contrast), "which" clauses, -ing clauses after a comma (", saying that ..."), idioms, phrasal verbs with a hidden meaning ("put off", "turn down"), newspaper short words (amid, vow, slam, probe, bid, mull, eye).
- What someone said: He said, "..." or "He said that ..." in simple words.
- No contractions (write "do not", "it is").
- Words: everyday A1/A2 words; mark [NEW] anything above.`,
    },
    B1: {
      words: 170, maxWords: 22, maxSub: 2, newWords: [5, 9],
      rules: `- Tenses: all simple and continuous tenses, present perfect, past perfect only when the order of events needs it.
- Sentences: about 10-18 words, never more than 22; at most two clauses joined to a main clause.
- Allowed: passive, relative clauses (who, which, that, where, whose), first and second conditional, although, however, while, unless, so that, reported speech, common phrasal verbs ("find out", "set up").
- NOT allowed: third or mixed conditional, inversion ("Not only did ..."), whereas / nevertheless / notwithstanding / hence / thus, -ing clause as a sentence opener, idioms, newspaper short words (amid, vow, slam, mull, eye).
- Words: B1 vocabulary; mark [NEW] anything more formal.`,
    },
    B2: {
      words: 240, maxWords: 30, maxSub: 3, newWords: [6, 10],
      rules: `- Style: real news English, slightly simplified. All tenses, passive, conditionals and reported speech are fine.
- Sentences: about 12-25 words, never more than 30. No clause nested three deep.
- NOT allowed: rare idioms, headline shorthand (mull, eye, slam), cultural references without explanation, sentences that need to be read twice.
- Words: B2 vocabulary; mark [NEW] what is above it.`,
    },
  },

  reviewChecks: `- Articles (a / an / the / none) and singular-plural agreement.
- Prepositions and verb patterns ("discuss the plan", not "discuss about the plan").
- One time frame: do not switch between past and present for the same event.
- Natural word choice: no Japanese-English ("claim" for complaint, "challenge" for try) and no dictionary-stiff words where a plain one exists.
- Numbers and dates in one style: "3.5 percent", "1,000", "on November 21".`,

  subordinators: /(?:,\s+|\s)(?:because|when|if|that|although|though|while|unless|whether|which|who|whose|where|after|before|since|until)\s/giu,

  phrases: [
    { rule: 'tense', levels: BEGINNER, re: words(`had (?:\\p{L}+ly )?${PP}`, 'iu'), hint: 'past perfect is above A1-A2 — use past simple and put the events in order' },
    { rule: 'tense', levels: BEGINNER, re: words('(?:has|have|had) been \\p{L}+(?:ed|en|ing)|(?:is|are|was|were) being', 'iu'), hint: 'perfect / continuous passive or perfect continuous is above A1-A2 — use a simple active sentence' },
    { rule: 'grammar-level', levels: BEGINNER, re: /(?<![\p{L}])would(?! like)(?![\p{L}])/iu, hint: '"would" is above A1-A2 (only "would like") — use "will", "wants to" or "plans to"' },
    { rule: 'grammar-level', levels: BEGINNER, re: words('although|though|despite|in spite of|however|therefore|moreover|furthermore|unless|whether|whereas|due to|in order to|as well as', 'iu'), hint: 'this connector is B1 or higher — use and / but / so / because' },
    { rule: 'grammar-level', levels: BEGINNER, re: /,\s+(?:which|whose|whom)\s/iu, hint: '"which" clause is above A1-A2 — make two sentences' },
    { rule: 'grammar-level', levels: UP_TO_B1, re: /,\s+(?:saying|adding|citing|noting|calling|making|leaving|causing|raising|according)\s/iu, hint: '-ing clause after a comma — start a new sentence ("He said that ...")' },
    { rule: 'grammar-level', levels: UP_TO_B1, re: words('would have|could have|might have|should have', 'iu'), hint: 'third conditional / past modal is B2 — say what really happened' },
    { rule: 'grammar-level', levels: UP_TO_B1, re: words('whereas|nevertheless|nonetheless|notwithstanding|hence|thus|thereby', 'iu'), hint: 'formal connector — use but / however / so' },
    { rule: 'journalese', re: words('amid|amidst|vow(?:s|ed)?|slam(?:s|med)?|mull(?:s|ed)?|eye(?:s|d) (?:a|an|the|new)|probe(?:s|d)?|blast(?:s|ed)?', 'iu'), hint: 'newspaper short word — use the plain word (during, promised, criticised, is thinking about, investigation)' },
    { rule: 'contraction', levels: BEGINNER, re: /\p{L}+(?:n't|'re|'ve|'ll)(?![\p{L}])|(?<![\p{L}])(?:it|that|he|she|there)'s(?![\p{L}])/iu, hint: 'no contractions at A1-A2 — write the full form' },
    { rule: 'meta', re: /\b(?:reported|wrote|published)\s+(?:about\s+)?this\s+(?:news|story)\b/iu, hint: 'a sentence about who reported the news is not news — delete it' },
    { rule: 'filler', re: /^(?:In other words|That is to say|In short|Simply put)[,:]/u, hint: 'filler sentence that repeats the one before — delete it or add a new fact' },
  ],

  fragmentRe: /^(?:Because|Although|Which|While|Unless)\s[^,]*\.$/u,
  splitAfterShortNumber: true,

  stop: new Set(('about after also been being from have into more most much many must new over said says some than that the their them then there these they this ' +
    'those very were what when where which will with would year years people could should other only just like make made does did')
    .split(' ').map(w => w.slice(0, 5))),
  skipCapitalizedInRepeats: true, // capitals inside a sentence are names

  checkVocab() { return null; },
  vocabFormat: `"base": dictionary form. Verbs as the plain form; add irregular forms ("rise (rose, risen)"). Nouns in the singular; add "(uncountable)" or an irregular plural when it applies. Phrasal verbs as a whole ("set up").`,
  quizGrammar: 'articles (a / an / the), prepositions, verb tense, singular and plural',
};
