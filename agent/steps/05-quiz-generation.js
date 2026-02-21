// Pipeline Step 5: Quiz Generation
// Creates quiz questions based on the article and vocabulary.
// Mix of question types: meaning, context, correction, comprehension, etc.

const { callClaudeJSON } = require('../../server/services/claude');
const { buildQuizGenerationPrompt } = require('../prompts/system-prompt-builder');

/**
 * Generate quiz questions for an article.
 * @param {object} article - Output from Step 3 (body_romaji, title, translation)
 * @param {object} vocabulary - Output from Step 4 (newWords, reviewWords)
 * @param {object} config - User configuration
 * @returns {object} { questions[] }
 */
async function generateQuiz(article, vocabulary, config) {
  console.log('[Step 5] Generating quiz...');

  const systemPrompt = buildQuizGenerationPrompt(config);

  const newWordsList = (vocabulary.newWords || [])
    .map(w => `${w.word_romaji_macron} = ${w.meaning_en} (${w.part_of_speech})`)
    .join('\n');

  const userPrompt = `Generate ${config.quiz_questions_count} quiz questions for this article:

## Article (Romaji)
${article.body_romaji}

## Article Title
${article.title_romaji}

## English Translation
${article.translation_en}

## New Vocabulary to Test
${newWordsList}

## Requirements
- Generate exactly ${config.quiz_questions_count} questions
- Mix of types: at least 2 vocabulary meaning, 1 context fill-in-blank, 1 comprehension, 1 romaji correction
- All questions in romaji (with macrons where needed)
- Multiple choice questions need exactly 3 distractors (wrong answers)
- Distractors should be plausible (same category/level) but clearly wrong
- Include a hint for each question
- Comprehension questions should test understanding of the NEWS content, not just vocabulary

Return as the specified JSON format.`;

  const result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 4096,
  });

  console.log(`[Step 5] Generated ${result.questions?.length || 0} quiz questions`);

  return result;
}

module.exports = { generateQuiz };
