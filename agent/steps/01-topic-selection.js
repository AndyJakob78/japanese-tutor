// Pipeline Step 1: Topic Selection
// Picks a news topic based on user config and recent article history.
// Uses Claude (no web search needed — this is just decision-making).

const { callClaudeJSON } = require('../../server/services/claude');
const { buildTopicSelectionPrompt } = require('../prompts/system-prompt-builder');
const { collections } = require('../../server/services/firestore');

/**
 * Select a topic for the next article.
 * @param {object} config - User configuration from the database
 * @returns {object} { topic, region, category, searchQueries[], rationale }
 */
async function selectTopic(config) {
  console.log('[Step 1] Selecting topic...');

  // Get recent article topics to avoid repeats
  const recentSnapshot = await collections.articles
    .orderBy('created_at', 'desc')
    .limit(10)
    .get();

  const recentArticles = recentSnapshot.docs.map(doc => {
    const data = doc.data();
    return { topic: data.topic, region: data.region, created_at: data.created_at };
  });

  const systemPrompt = buildTopicSelectionPrompt(config);

  const userPrompt = `Select a current news topic for a Japanese language learning article.

Today's date: ${new Date().toISOString().split('T')[0]}

${recentArticles.length > 0
    ? `Recent articles (AVOID repeating these topics):\n${recentArticles.map(a => `- ${a.topic} (${a.region}, ${a.created_at})`).join('\n')}`
    : 'No recent articles yet — pick any topic from the configured interests.'}

Pick a specific, concrete topic from the configured topics and regions. Be specific — not "economy" but "Germany Q4 GDP growth" or "Bank of Japan interest rate decision".`;

  const result = await callClaudeJSON(systemPrompt, userPrompt);

  console.log(`[Step 1] Selected: "${result.topic}" (${result.region}, ${result.category})`);
  return result;
}

module.exports = { selectTopic };
