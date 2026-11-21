// Sentence practice and word lookup for German / English (Claude calls).
// The learner is a Japanese speaker: every explanation is in Japanese.

const { callClaudeJSON } = require('../server/services/claude');
const { MISTAKE_TYPES, patternKey } = require('./learn');

const MAX_SENTENCE = 300;

function sentencePrompt(lang, level) {
  const types = Object.keys(MISTAKE_TYPES[lang.key]).join(' | ');
  return `You are a kind, precise ${lang.name} teacher. Your student is a Japanese speaker at level ${level}.

Check ONE ${lang.name} sentence the student wrote. They were asked to use the target words listed in the message.

Respond with ONLY JSON:
{"verdict":"correct" | "almost" | "wrong",
 "corrected":"the full corrected ${lang.name} sentence",
 "translation":"what the corrected sentence means, in natural Japanese",
 "fixes":[{"wrote":"the wrong part, copied from the student","correct":"the fixed part","why":"one short line in simple Japanese","type":"${types}","pattern":"short reusable label of the mistake in ${lang.name}/symbols, e.g. ${lang.key === 'de' ? '\\"der → den (Akkusativ)\\", \\"Verb ans Ende nach weil\\", \\"hat → ist bei Bewegung\\"' : '\\"a → the (known thing)\\", \\"go → went (past)\\", \\"in → on (days)\\"'}"}],
 "words":[{"word":"target word","used_correctly":true}],
 "tip":"one short encouraging line in Japanese, or a tip if there was a mistake"}

Rules:
- Keep the student's meaning. Change as little as possible: fix real mistakes only. Do not rewrite a correct sentence into a "nicer" one.
- Ignore missing punctuation and capital letters at the sentence start.${lang.key === 'de' ? ' A noun without its capital letter IS a mistake (type spelling). Accept ae/oe/ue/ss typed for ä/ö/ü/ß.' : ''}
- "fixes": at most 4, each about one small part, not the whole sentence. Empty when the sentence is correct.
- "pattern" names the KIND of mistake so the same slip in another sentence gets the same label. No sentence-specific nouns.
- "why": one line a level ${level} learner understands, in Japanese (です・ます体).
- "verdict": "correct" = no fixes; "almost" = 1-2 small fixes; "wrong" = the sentence does not work or a target word has the wrong meaning.
- "words": one entry per target word. used_correctly = the word (any form of it) appears with the right meaning. A missing target word is false.
- If the student wrote Japanese or something that is not a ${lang.name} sentence: verdict "wrong", fixes empty, and the tip says what to do.`;
}

/** Check one sentence. Returns the cleaned result (nothing is saved here). */
async function checkSentence(lang, level, { words, sentence, context, focus }) {
  const list = words.map(w => `- ${String(w.word || '').slice(0, 60)} (${String(w.meaning || '').slice(0, 80)})`).join('\n');
  const user = `Target words:\n${list}\n${context ? `\nThe sentence should be about this article: ${String(context).slice(0, 200)}\n` : ''}${focus ? `\nThe student often gets this wrong, so check it carefully: ${String(focus).slice(0, 120)}\n` : ''}\nStudent's sentence:\n${sentence.trim()}`;
  const r = await callClaudeJSON(sentencePrompt(lang, level), user, { effort: 'low' });
  const types = Object.keys(MISTAKE_TYPES[lang.key]);
  return {
    verdict: ['correct', 'almost', 'wrong'].includes(r.verdict) ? r.verdict : 'almost',
    corrected: String(r.corrected || ''),
    translation: String(r.translation || ''),
    fixes: (Array.isArray(r.fixes) ? r.fixes : []).slice(0, 4).map(f => ({
      wrote: String(f.wrote || ''), correct: String(f.correct || ''), why: String(f.why || ''),
      type: types.includes(f.type) ? f.type : 'other', pattern: patternKey(f.pattern) || patternKey(`${f.wrote} → ${f.correct}`),
    })),
    words: (Array.isArray(r.words) ? r.words : []).map(w => ({ word: String(w.word || ''), used_correctly: w.used_correctly === true })),
    tip: String(r.tip || ''),
  };
}

/** Explain any word the learner tapped in an article. */
async function lookupWord(lang, word, sentence) {
  const system = `You explain one word from a ${lang.name} news article to a Japanese speaker who learns ${lang.name}.

Respond with ONLY JSON:
{"base":"dictionary form. ${lang.vocabFormat.replace(/"base": dictionary form\. /, '').replace(/"/g, '\\"')}",
 "pos":"noun | verb | adjective | adverb | phrase | name | other",
 "meaning":"short Japanese meaning AS USED IN THIS SENTENCE (dictionary style)",
 "note":"one short Japanese line if the tapped form differs from the dictionary form (e.g. 「gehen の過去分詞」「複数形」), otherwise empty",
 "example":"a NEW short ${lang.name} sentence with this word","example_translation":"its Japanese translation"}

The tapped word may carry punctuation — explain the main word. For a name (person, company, place) give pos "name" and say who or what it is in "meaning".`;
  const r = await callClaudeJSON(system, `Tapped word: ${word}\nSentence: ${sentence || word}`, { effort: 'low' });
  return {
    word, base: String(r.base || word), pos: String(r.pos || ''), meaning: String(r.meaning || ''), note: String(r.note || ''),
    example: String(r.example || ''), example_translation: String(r.example_translation || ''),
  };
}

module.exports = { checkSentence, lookupWord, MAX_SENTENCE };
