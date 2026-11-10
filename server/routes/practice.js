// Practice routes (2026-11-10)
// POST /api/practice/sentence — check a sentence the learner wrote with article words
// POST /api/practice/lookup   — meaning of any word tapped in an article
//
// The app trains recognition (quizzes); the learner's lessons show the gap is
// production: particles in long sentences, quotes, verb pairs. Here the learner
// writes their own sentence and gets a "You wrote | Correct" table back.

const express = require('express');
const router = express.Router();
const { callClaudeJSON } = require('../services/claude');
const { _internals: { loadConfig, findExistingVocab } } = require('../../agent/pipeline');
const { lookupLevel } = require('../../agent/middleware/jlpt-levels');

const MAX_SENTENCE = 300;

function buildSystemPrompt(level) {
  return `You are a kind, precise Japanese teacher. Your student is at JLPT ${level} level and writes Japanese in Hepburn romaji.

Check ONE sentence the student wrote. They were asked to use the target words listed in the message.

Respond with ONLY JSON:
{"verdict":"correct" | "almost" | "wrong",
 "corrected":"the full corrected sentence",
 "english":"what the corrected sentence means, in plain English",
 "fixes":[{"wrote":"the wrong part, copied from the student","correct":"the fixed part","why":"one short, plain English line"}],
 "words":[{"word":"target word","used_correctly":true}],
 "tip":"one short encouraging line, or a tip if there was a mistake"}

Rules:
- Keep the student's meaning. Change as little as possible: fix real mistakes only (particles, verb forms, word order, wrong word, a target word used with the wrong meaning). Do not rewrite a correct sentence into a "nicer" one.
- Ignore missing macrons, long vowels written as "ou"/"oo"/"uu", capital letters and missing punctuation. Never list those as fixes. Only mention a long vowel when it changes the meaning (seito vs seitō).
- "corrected": Hepburn romaji with macrons (ā ī ū ē ō), "wo" for を, "wa" for the particle は. No hiragana, katakana or kanji anywhere in the JSON.
- "fixes": at most 4, each about one small part (a particle, a verb ending), not the whole sentence. Empty when the sentence is correct.
- "why": one line a ${level} learner understands (e.g. "agaru happens by itself → ga, not wo"). No grammar jargon beyond particle and verb names.
- "verdict": "correct" = no fixes; "almost" = 1–2 small fixes (particle, ending); "wrong" = the sentence does not work or a target word has the wrong meaning.
- "words": one entry per target word. used_correctly = the word appears with the right meaning (a wrong particle around it is still used_correctly true). A target word that is missing is false.
- If the student wrote English or something that is not a sentence, verdict "wrong", fixes empty, and the tip explains what to do.`;
}

// POST /api/practice/sentence { words: [{ word, meaning }], sentence, context? }
router.post('/sentence', async (req, res, next) => {
  try {
    const { words, sentence, context } = req.body || {};
    if (typeof sentence !== 'string' || !sentence.trim()) {
      return res.status(400).json({ error: 'Must provide "sentence"' });
    }
    if (sentence.length > MAX_SENTENCE) {
      return res.status(400).json({ error: `Sentence too long (max ${MAX_SENTENCE} characters)` });
    }
    if (!Array.isArray(words) || words.length === 0 || words.length > 3) {
      return res.status(400).json({ error: 'Must provide 1–3 "words"' });
    }

    const config = await loadConfig(req.userId);
    const level = config.proficiency_level || 'N4';
    const wordList = words
      .map(w => `- ${String(w.word || '').slice(0, 40)} (${String(w.meaning || '').slice(0, 80)})`)
      .join('\n');
    const userPrompt = `Target words:\n${wordList}\n${context ? `\nThe sentence should be about this article: ${String(context).slice(0, 200)}\n` : ''}\nStudent's sentence:\n${sentence.trim()}`;

    const result = await callClaudeJSON(buildSystemPrompt(level), userPrompt, { effort: 'low' });
    res.json({
      verdict: ['correct', 'almost', 'wrong'].includes(result.verdict) ? result.verdict : 'almost',
      corrected: String(result.corrected || ''),
      english: String(result.english || ''),
      fixes: (Array.isArray(result.fixes) ? result.fixes : []).slice(0, 4).map(f => ({
        wrote: String(f.wrote || ''), correct: String(f.correct || ''), why: String(f.why || ''),
      })),
      words: (Array.isArray(result.words) ? result.words : []).map(w => ({
        word: String(w.word || ''), used_correctly: w.used_correctly === true,
      })),
      tip: String(result.tip || ''),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/practice/lookup { word, sentence } (2026-11-10)
// Only article vocabulary used to be tappable; any other unknown word broke the
// reading flow. Claude gives the dictionary form and meaning in this sentence.
const LOOKUP_PROMPT = `You explain one word from a Japanese news article to a learner who reads Hepburn romaji.

Respond with ONLY JSON:
{"word_romaji_macron":"dictionary form in Hepburn romaji with macrons (sagatta → sagaru, tsukaimasu → tsukau)",
 "word_kanji":"standard kanji spelling or null","word_kana":"reading in hiragana/katakana",
 "meaning_en":"short English meaning AS USED IN THIS SENTENCE (1–4 words; verbs start with 'to')",
 "part_of_speech":"noun | verb | adjective | adverb | particle | expression | name",
 "note":"one short line if the tapped form differs from the dictionary form (\"past tense of sagaru\", \"-te imasu: is ...ing\"), or for a particle what it does here; otherwise empty"}

meaning_en and note are English plus romaji only — never hiragana, katakana or kanji there (the learner can't read them).
The tapped word may carry punctuation or a particle glued on — explain the main word. For a name (person, company, place) give part_of_speech "name" and say who/what it is in meaning_en.`;

router.post('/lookup', async (req, res, next) => {
  try {
    const word = String(req.body?.word || '').trim().slice(0, 40);
    const sentence = String(req.body?.sentence || '').trim().slice(0, 400);
    if (!word) return res.status(400).json({ error: 'Must provide "word"' });

    const result = await callClaudeJSON(LOOKUP_PROMPT, `Tapped word: ${word}\nSentence: ${sentence || word}`, { effort: 'low' });
    const entry = {
      word_romaji_macron: String(result.word_romaji_macron || word).toLowerCase(),
      word_kanji: result.word_kanji || null,
      word_kana: result.word_kana || null,
      meaning_en: String(result.meaning_en || ''),
      part_of_speech: result.part_of_speech || null,
      note: String(result.note || ''),
    };
    entry.jlpt_level = lookupLevel(entry);
    const existing = await findExistingVocab(entry, req.userId);
    entry.vocabulary_id = existing ? existing.data().id : null;
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
