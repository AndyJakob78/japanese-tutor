// Pipeline Step 4: Vocabulary Extraction
// Extracts and classifies vocabulary from the generated article.
// Identifies new words and review words with full metadata.

const { callClaudeJSON } = require('../../server/services/claude');
const { buildVocabularyExtractionPrompt } = require('../prompts/system-prompt-builder');

/**
 * Extract vocabulary from a generated article.
 * @param {object} article - Output from Step 3 (body_romaji, translation_en)
 * @param {object} config - User configuration
 * @returns {object} { newWords[], reviewWords[] }
 */
async function extractVocabulary(article, config) {
  console.log('[Step 4] Extracting vocabulary...');

  const systemPrompt = buildVocabularyExtractionPrompt(config);

  const userPrompt = `Extract vocabulary from this Japanese learning article:

## Article (Romaji)
${article.body_romaji}

## English Translation
${article.translation_en}

## Title
${article.title_romaji}

## Requirements
- Extract ALL words marked with [NEW] as new vocabulary (should be ~${config.new_words_per_article})
- Extract words marked with [REVIEW] as review vocabulary
- For each new word provide: romaji (plain + macron), kanji, kana, meaning, part of speech, JLPT level, category
- For each word provide the context sentence from the article where it appears
- Classify JLPT level accurately (N5 = most basic, N1 = most advanced)
- Categories: politics, finance, tech, startups, general

Return as the specified JSON format.`;

  const result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 4096,
  });

  console.log(`[Step 4] Extracted ${result.newWords?.length || 0} new words, ${result.reviewWords?.length || 0} review words`);

  return result;
}

module.exports = { extractVocabulary };
