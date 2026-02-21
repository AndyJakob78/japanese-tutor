// Pipeline Step 3: Article Generation
// Generates a Japanese language learning article in Hepburn romaji
// based on real news data from Step 2.

const { callClaudeJSON } = require('../../server/services/claude');
const { buildArticleGenerationPrompt } = require('../prompts/system-prompt-builder');
const { collections } = require('../../server/services/firestore');

/**
 * Generate a Japanese learning article from news data.
 * @param {object} newsData - Output from Step 2 (articles with facts)
 * @param {object} topicPlan - Output from Step 1 (topic, region, category)
 * @param {object} config - User configuration
 * @returns {object} Generated article with all sections
 */
async function generateArticle(newsData, topicPlan, config) {
  console.log('[Step 3] Generating article...');

  // Get known/learning vocabulary for reuse
  const knownWordsSnapshot = await collections.vocabulary
    .where('status', 'in', ['learning', 'known', 'mastered'])
    .orderBy('times_seen', 'desc')
    .limit(200)
    .get();

  const knownWords = knownWordsSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      word_romaji_macron: data.word_romaji_macron,
      meaning_en: data.meaning_en,
      jlpt_level: data.jlpt_level,
    };
  });

  const systemPrompt = buildArticleGenerationPrompt(config);

  // Build the news context from search results
  const newsContext = newsData.articles.map(a => {
    return `Source: ${a.source} (${a.date})
Headline: ${a.headline}
Key facts: ${a.keyFacts?.join('; ') || 'none'}
Numbers: ${a.numbers?.join(', ') || 'none'}
Quotes: ${a.quotes?.join(' | ') || 'none'}`;
  }).join('\n\n');

  const userPrompt = `Write a Japanese language learning article based on this news:

## Topic
${topicPlan.topic} (${topicPlan.region})

## News Data
${newsContext}

## Summary
${newsData.summary}

## Known Vocabulary (reuse these words naturally)
${knownWords.length > 0
    ? knownWords.slice(0, 50).map(w => `${w.word_romaji_macron} = ${w.meaning_en}`).join('\n')
    : 'No known vocabulary yet — this is the first article.'}

## Requirements
- Write entirely in Hepburn romaji with macrons (ā, ī, ū, ē, ō)
- NEVER use hiragana, katakana, or kanji in the article body
- Target article length: approximately ${config.target_word_count || 200} words
- Max sentence length: ${config.max_sentence_length} words
- Introduce exactly ${config.new_words_per_article} new words, marked with [NEW]
- Mark reused vocabulary with [REVIEW] on first appearance
- Target level: ${config.proficiency_level}
- Include 1-2 grammar points
- Cite sources using "~ni yoru to" pattern

Return the article as the specified JSON format.`;

  const result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 8192,
    temperature: 0.8,
  });

  console.log(`[Step 3] Article generated: "${result.title_romaji}"`);
  console.log(`[Step 3] Word count: ${result.word_count}, New words: ${result.new_word_count}`);

  return result;
}

module.exports = { generateArticle };
