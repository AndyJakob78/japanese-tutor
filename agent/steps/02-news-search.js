// Pipeline Step 2: News Search
// Searches the web for current news articles using Claude's web_search tool.
// This is the first step that uses real-time data.

const { callClaudeSearchJSON } = require('../../server/services/claude');
const { buildNewsSearchPrompt } = require('../prompts/system-prompt-builder');

/**
 * Search for current news on the selected topic.
 * @param {object} topicPlan - Output from Step 1 (topic, region, searchQueries)
 * @param {object} config - User configuration
 * @returns {object} { articles[], summary }
 */
async function searchNews(topicPlan, config) {
  console.log('[Step 2] Searching for news...');
  console.log(`[Step 2] Topic: "${topicPlan.topic}"`);
  console.log(`[Step 2] Queries: ${topicPlan.searchQueries.join(', ')}`);

  const systemPrompt = buildNewsSearchPrompt(config);

  const userPrompt = `Search for current news about: ${topicPlan.topic}
Region focus: ${topicPlan.region}
Category: ${topicPlan.category}

Today's date: ${new Date().toISOString().split('T')[0]}

Search queries to try (use these as starting points, refine as needed):
${topicPlan.searchQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Find 2-3 high-quality news articles with specific facts, numbers, and named sources.
Return the results as the specified JSON format.`;

  const result = await callClaudeSearchJSON(systemPrompt, userPrompt, {
    max_searches: 5,
    max_tokens: 8192,
  });

  console.log(`[Step 2] Found ${result.articles?.length || 0} articles`);
  if (result.articles) {
    result.articles.forEach((a, i) => {
      console.log(`[Step 2]   ${i + 1}. "${a.headline}" (${a.source})`);
    });
  }

  return result;
}

module.exports = { searchNews };
