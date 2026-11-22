// Prompts for the German / English pipeline. The reader is a Japanese
// speaker: the article is in the language they learn; the translation, the
// word meanings and all quiz instructions are in Japanese.

const STORY_RULES = `## A story that reads well
- Every sentence is a full sentence with a subject and a verb.
- Each fact appears ONCE. Never restate the sentence before in other words.
- Order: what happened → who and where → the important details → what comes next. Background comes after the news, not before it.
- One time frame for one event. Do not jump between past and present.
- If the result is mixed (part worked, part failed), say so first, then give the two parts.
- No sentence about the source ("X reported this news"). The news itself is the content.
- No filler openers ("That means", "In other words") and no closing moral.
- Use the natural word a native writer would use. Do not translate word by word from another language.`;

const FACT_RULES = `## Facts
- Use ONLY facts from the news data below. Do not add numbers, names, dates, quotes, reasons or reactions that are not there.
- If the news data is thin, write a shorter article. Never pad.
- Keep names of people, companies and places in their normal spelling. Numbers as digits.`;

function levelBlock(lang, level) {
  return `## Level ${level} — hard rules\n${lang.levels[level].rules}`;
}

function newsBlock(news) {
  return `## News data\nTopic: ${news.topic}\n${(news.articles || []).map((a, i) =>
    `Source ${i + 1}: ${a.headline} (${a.source}, ${a.date || 'n.d.'})\nFacts:\n${(a.keyFacts || []).map(f => `- ${f}`).join('\n')}` +
    `${(a.numbers || []).length ? `\nNumbers: ${a.numbers.join('; ')}` : ''}${(a.quotes || []).length ? `\nQuotes: ${a.quotes.join(' | ')}` : ''}`).join('\n\n')}`;
}

// What kind of story a level can carry. A beginner article has about 110
// words and everyday vocabulary — a study about gut bacteria cannot be told
// with that (first German test, 2026-11-21).
const STORY_FIT = {
  'A1-A2': 'The reader is a BEGINNER. Pick a story that can be told with everyday words and 5-6 simple facts: something that opened, was built, was found, was won, was decided; animals, weather, travel, food, sport, a new product, a record, a festival. NOT medicine, biology, chemistry, finance, law or anything that needs technical terms or Latin names.',
  B1: 'The reader is at intermediate level. Pick a story with a clear chain of events and little jargon. Avoid stories that depend on technical terms.',
  B2: 'The reader is at upper-intermediate level. Any general-interest story works; avoid specialist papers.',
};

function searchPrompts(lang, topicHint, recentTopics = [], level = 'B1', where = {}) {
  const today = new Date().toISOString().split('T')[0];
  const days = where.days || 10;
  const window = days <= 1 ? 'the last 24 hours' : `the last ${days} days`;
  // the learner's own regions; without any, the language's home region
  const place = (where.regions || []).length ? `these places (from them or about them): ${where.regions.join(', ')}` : lang.newsRegion;
  return {
    system: `You find one current news story for a language-learning article. Search the web, pick ONE concrete story from ${window} with clear facts (who, what, where, when, numbers). Prefer stories that are easy to tell in simple words: society, technology, science, culture, transport, sport, weather. Avoid crime details, war, protests and party politics.
- Use established news outlets or the organisation's own announcement; no blogs, no partisan sites.
- Only report facts you actually read in the search results. If you could read only a headline, pick another story.
- Check that weekday and date fit together; leave the weekday out if unsure.
- You have a limited number of searches. Take the FIRST story that fits; do not keep looking for a better one. Search results (titles and snippets from several outlets) count as read when they give the facts.
Return ONLY JSON:
{"topic": "one sentence", "region": "...", "category": "...", "articles": [{"headline": "...", "source": "...", "url": "...", "date": "YYYY-MM-DD", "keyFacts": ["6-10 short facts in English"], "numbers": ["..."], "quotes": ["short quotes with the speaker"]}]}`,
    user: `Today is ${today}. Find a news story from ${place}.${days < 4 ? ' If nothing fits in that time, take the most recent story that does.' : ''}${topicHint ? ` Topic wish: ${topicHint}.` : ''} Use 1-2 sources.\n${STORY_FIT[level] || ''}${topicHint && level === 'A1-A2' ? ' If the topic wish only offers hard stories, take an easy story from another topic.' : ''}` +
      (recentTopics.length ? `\nThe learner already read about these — pick a DIFFERENT story:\n${recentTopics.slice(0, 10).map(t => `- ${t}`).join('\n')}` : ''),
  };
}

function writerPrompts(lang, level, news, knownWords = [], extras = {}) {
  const review = extras.reviewWords || [];
  const spots = (extras.weakSpots || []).slice(0, 3);
  const L = lang.levels[level];
  return {
    system: `You write short news articles in ${lang.name} for Japanese speakers who learn ${lang.name}. The article must be correct, natural ${lang.name} that a native editor would accept, written strictly inside the learner's level.

${levelBlock(lang, level)}

${STORY_RULES}

${FACT_RULES}

${L.newWords[1] === 0 ? `## No new words
- The learner asked for an article WITHOUT new words. Use only words a learner at ${level} already knows, plus the words listed in the message. Never write [NEW]. "vocabulary" is [].
- If the story needs a harder word, say it with easy words instead.` : `## New words
- Mark the ${L.newWords[0]}-${L.newWords[1]} words a learner at ${level} most likely does not know with [NEW] directly before the word, the first time it appears: "Die [NEW] Regierung plant ...". Never mark names.
- Every marked word gets one vocabulary entry; nothing else goes into the vocabulary.
- ${lang.vocabFormat}`}

## Japanese parts (the learner reads these)
- "translation_ja": the whole article in natural Japanese (です・ます体), sentence by sentence in the same order, same paragraphs. Faithful: nothing added, nothing left out. Foreign names in katakana.
- "meaning_ja": the meaning of the word AS USED in this article, short (dictionary style).
- "example_ja": natural Japanese translation of the example sentence.
- "grammar_note": ONE grammar point of level ${level} that really occurs in the article, explained in simple Japanese in 2-3 sentences, with the sentence from the article.

## Output — ONLY this JSON
{
  "title": "short headline in ${lang.name}, inside the level",
  "summary": "one sentence in ${lang.name}, inside the level",
  "body": "${Math.round(L.words * 0.85)}-${Math.round(L.words * 1.1)} words (count them; never more than ${Math.round(L.words * 1.2)} — leave out the least important facts instead), 2-4 paragraphs separated by \\n\\n, with [NEW] markers",
  "translation_ja": "...",
  "vocabulary": [{"word": "exactly as written in the body", "base": "...", "pos": "noun|verb|adjective|adverb|phrase", "meaning_ja": "...", "example": "a NEW short sentence at level ${level}, not from the article", "example_ja": "..."}],
  "grammar_note": {"point": "name of the point in ${lang.name}", "explanation_ja": "...", "sentence": "the sentence from the article"}
}`,
    user: `${newsBlock(news)}\n\n` +
      (knownWords.length ? `## Words this learner already met in earlier articles\nDo NOT mark these [NEW] again; using them is welcome.\n${knownWords.slice(0, 150).join(', ')}\n\n` : '') +
      (review.length ? `## Words to bring back (the learner is still learning them)\nUse each one where it fits the story, and write [REVIEW] directly before it the first time: "Die [REVIEW] Regierung ...". Do NOT give them a vocabulary entry. If a word does not fit the story, leave it out — never bend the news for it.\n${review.map(w => `- ${w.base} (${w.meaning})`).join('\n')}\n\n` : '') +
      (spots.length ? `## The learner's weak spots (from sentences they wrote themselves)\n${spots.map(s => `- ${s.type_label}: ${s.pattern} — wrote "${s.example.wrote}", correct is "${s.example.correct}"`).join('\n')}\nWhere a pattern fits a sentence the story needs anyway, use it correctly there, and prefer it for the grammar_note. Never add a sentence just to practise a pattern.\n\n` : '') +
      `Write the ${level} article in ${lang.name} now.`,
  };
}

function reviewerPrompts(lang, level, article, news, lintBlock) {
  return {
    system: `You are a strict ${lang.name} editor and Japanese translator. You check a short learner article (level ${level}, readers are Japanese speakers) and return the corrected version. Change only what is wrong; do not rewrite good sentences.

Check, in this order:
1. Facts: every statement must be supported by the news data. Delete or correct anything that is not. Do not add new facts.
2. Level: the hard rules below. Rewrite every sentence that breaks one, keeping the meaning.
3. Correct and natural ${lang.name}:
${lang.reviewChecks}
4. Reads well: full sentences, no repeated fact, no filler sentence, no sentence about the source, one time frame, news first and background after.
5. [NEW] and [REVIEW] markers stay directly before their word. If you replace a marked word with an easier one, remove the marker. Add a new [NEW] marker only when the CODE CHECK asks for it, and then give the full entry in \"vocab_add\" (same format as the vocabulary list); otherwise \"vocab_add\" is [].
6. Japanese translation: faithful to the (corrected) article, sentence by sentence, natural です・ます体, no additions.
7. Vocabulary: the Japanese meaning fits the word as used in the article; the dictionary form is right (${lang.key === 'de' ? 'article, plural, Perfekt form' : 'irregular forms'}); the example sentence is correct and inside the level.

${levelBlock(lang, level)}

## Output — ONLY this JSON
{
  "title": "...", "summary": "...", "body": "full corrected body with [NEW] markers",
  "translation_ja": "full corrected translation, or \\"\\" if no sentence of the article changed meaning and the translation was already right",
  "vocab_fixes": [{"word": "as in the vocabulary list", "base": "only fields that change", "meaning_ja": "...", "example": "...", "example_ja": "..."}],
  "vocab_add": [{"word": "exactly as in the body", "base": "...", "pos": "...", "meaning_ja": "...", "example": "...", "example_ja": "..."}],
  "fixes_made": ["from → to (reason), at most 10 words each; [] if nothing changed"]
}`,
    user: `${newsBlock(news)}

## Article to check
Title: ${article.title}
Summary: ${article.summary}
Body:
${article.body}

## Japanese translation
${article.translation_ja}

## Vocabulary
${(article.vocabulary || []).map(v => `- ${v.word} | ${v.base} | ${v.pos} | ${v.meaning_ja} | ${v.example} | ${v.example_ja}`).join('\n')}
${lintBlock ? `\n${lintBlock}\n` : ''}`,
  };
}

function quizPrompts(lang, level, article, count = 6) {
  // the three kinds in turn: 6 → 2 + 2 + 2, 7 → 3 + 2 + 2, 3 → 1 + 1 + 1
  const n = [0, 1, 2].map(k => Math.floor((count + 2 - k) / 3));
  const span = (from, k) => (k === 1 ? `${from}.` : k === 2 ? `${from}. and ${from + 1}.` : `${from}. to ${from + k - 1}.`);
  return {
    system: `You write a ${count}-question multiple-choice quiz for a ${lang.name} learner article. The learner is a Japanese speaker at level ${level}.

Questions, in this order:
${span(1, n[0])} "comprehension": a question about the content, in ${lang.name} inside level ${level}; four options in ${lang.name}.
${span(1 + n[0], n[1])} "vocabulary": "question" is the sentence from the article with the tested word in 【 】 ("Its data show 【wildfires】, dust and smoke."); the four options are Japanese meanings; "instruction_ja" is 「【 】の単語の意味を選んでください。」 (never "underlined" — the app cannot underline). Each question a different word; if the article has a [REVIEW] word, one question uses it. If the vocabulary list below is empty, take useful words from the article.
${span(1 + n[0] + n[1], n[2])} "grammar": a sentence from the article with ONE gap (____); four options in ${lang.name}. Test: ${lang.quizGrammar}. Each question a different point. Exactly one option may be correct.

Rules:
- The right answer must be decidable from the article alone, and only one option is right.
- All four options have similar length and form; the right one must not stand out. Wrong options are plausible, not silly.
- Put the right answer in a different position for each question.
- Never write the [NEW] marker in the quiz.
- "instruction_ja": the task in Japanese (for example 「記事の内容に合うものを選んでください。」).
- "explanation_ja": 1-2 sentences in simple Japanese saying why the answer is right; quote the ${lang.name} words it depends on.

Output — ONLY this JSON:
{"questions": [{"type": "comprehension|vocabulary|grammar", "instruction_ja": "...", "question": "...", "options": ["...", "...", "...", "..."], "answer_index": 0, "explanation_ja": "..."}]}`,
    user: `Article (level ${level}):\n${article.title}\n\n${article.body}\n\nVocabulary:\n${[...(article.vocabulary || []).map(v => `- ${v.word}: ${v.meaning_ja}`), ...(article.review_vocabulary || []).map(v => `- ${v.base} (review word): ${v.meaning}`)].join('\n')}`,
  };
}

module.exports = { searchPrompts, writerPrompts, reviewerPrompts, quizPrompts };
