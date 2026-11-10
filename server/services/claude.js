// Claude API client wrapper
// Provides two main functions:
//   callClaude(systemPrompt, userPrompt, options) — standard text generation
//   callClaudeWithSearch(systemPrompt, userPrompt, options) — with web_search tool

const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

// Load .env — Node v25 may set env vars to empty strings, so prefer parsed values
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim()
  || (dotenvResult.parsed && dotenvResult.parsed.ANTHROPIC_API_KEY);

const client = new Anthropic({
  apiKey: API_KEY,
});

const MODEL = 'claude-sonnet-5-5';

// Sonnet 5.5 notes (migrated from Haiku 4.5, 2026-10-18):
// - temperature/top_p/top_k with non-default values return a 400 → never sent.
// - Thinking is adaptive and ON by default; it counts toward max_tokens, so we
//   keep a generous floor (MIN_MAX_TOKENS). Depth is controlled via effort.
// - Safety classifiers can decline (stop_reason "refusal"); we opt into the
//   server-side fallback ("default" routing) so a decline is retried on
//   Anthropic's recommended model inside the same call.
const DEFAULT_EFFORT = 'medium';
const MIN_MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Shared request fields for every call.
 */
function baseParams(systemPrompt, options) {
  return {
    model: MODEL,
    max_tokens: Math.max(options.max_tokens || 0, MIN_MAX_TOKENS),
    output_config: { effort: options.effort || DEFAULT_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    // Use prompt caching: cache the large system prompt (skill files etc.)
    // so subsequent calls within 5 min reuse cached tokens (faster + cheaper)
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
  };
}

/**
 * Throw a clear error when the whole fallback chain declined the request.
 */
function assertNotRefused(response) {
  if (response.stop_reason === 'refusal') {
    const cat = response.stop_details?.category || 'unknown';
    throw new Error(`Claude declined the request (refusal, category: ${cat})`);
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper that retries on rate limit (429) errors.
 * Waits for the time specified in the retry-after header, or defaults to 60s.
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        // Get wait time from retry-after header, or default to 60s
        const retryAfter = parseInt(err.headers?.['retry-after'] || '60', 10);
        const waitTime = Math.max(retryAfter, 30); // at least 30s
        console.log(`[Claude] Rate limited. Waiting ${waitTime}s before retry (attempt ${attempt}/${maxRetries})...`);
        await sleep(waitTime * 1000);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Call Claude API for text generation (no tools).
 * @param {string} systemPrompt - System prompt providing context/instructions
 * @param {string} userPrompt - The user message / request
 * @param {object} [options] - Optional overrides (max_tokens, effort)
 * @returns {string} The text response from Claude
 */
async function callClaude(systemPrompt, userPrompt, options = {}) {
  return withRetry(async () => {
    const response = await client.beta.messages.create({
      ...baseParams(systemPrompt, options),
      messages: [{ role: 'user', content: userPrompt }],
    });
    assertNotRefused(response);

    // Log cache performance (helps track savings)
    if (response.usage) {
      const cached = response.usage.cache_read_input_tokens || 0;
      const total = response.usage.input_tokens || 0;
      if (cached > 0) {
        console.log(`[Claude] Cache hit: ${cached}/${total} input tokens cached (${Math.round(cached/total*100)}%)`);
      }
    }

    // Extract text from response content blocks
    const textBlocks = response.content.filter(b => b.type === 'text');
    return textBlocks.map(b => b.text).join('');
  });
}

/**
 * Call Claude API with the web_search tool enabled.
 * Handles the pause_turn loop automatically.
 *
 * @param {string} systemPrompt - System prompt providing context/instructions
 * @param {string} userPrompt - The user message / request
 * @param {object} [options] - Optional overrides (max_tokens, effort)
 * @returns {string} The final text response from Claude (after all searches complete)
 */
async function callClaudeWithSearch(systemPrompt, userPrompt, options = {}) {
  const messages = [{ role: 'user', content: userPrompt }];

  // Loop to handle pause_turn (Claude may need multiple turns for web search)
  let maxIterations = 10;
  while (maxIterations-- > 0) {
    const response = await withRetry(async () => {
      return await client.beta.messages.create({
        ...baseParams(systemPrompt, options),
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: options.max_searches || 5,
          }
        ],
        messages,
      });
    });
    assertNotRefused(response);

    // If Claude is done (end_turn or max_tokens), extract final text
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      const textBlocks = response.content.filter(b => b.type === 'text');
      return textBlocks.map(b => b.text).join('');
    }

    // If pause_turn, the server-side search loop paused — send the paused
    // assistant turn back unchanged and the server resumes automatically.
    // (No extra "Continue." user message: the API detects the trailing
    // server_tool_use block. Keeping the history append-only also keeps
    // Sonnet 5.5's thinking blocks valid.)
    if (response.stop_reason === 'pause_turn') {
      if (messages[messages.length - 1].role === 'assistant') messages.pop();
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    // Unexpected stop reason — return what we have
    console.warn('Unexpected stop_reason:', response.stop_reason);
    const textBlocks = response.content.filter(b => b.type === 'text');
    return textBlocks.map(b => b.text).join('');
  }

  throw new Error('Claude API: exceeded max iterations while handling web search');
}

/**
 * Call Claude and parse the response as JSON.
 */
async function callClaudeJSON(systemPrompt, userPrompt, options = {}) {
  const text = await callClaude(systemPrompt, userPrompt, options);
  return parseJSONFromText(text);
}

/**
 * Call Claude with web search and parse the response as JSON.
 */
async function callClaudeSearchJSON(systemPrompt, userPrompt, options = {}) {
  const text = await callClaudeWithSearch(systemPrompt, userPrompt, options);
  return parseJSONFromText(text);
}

/**
 * Try to fix common JSON issues (trailing commas, etc.) and parse.
 */
function tryParseJSON(text) {
  // First try as-is
  try {
    return JSON.parse(text);
  } catch (e) {
    // Fix trailing commas before ] or }
    let fixed = text
      .replace(/,\s*([\]}])/g, '$1')           // remove trailing commas
      .replace(/}\s*{/g, '},{');                 // fix missing comma between objects
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      // More aggressive: also try adding missing commas between lines
      fixed = text
        .replace(/,\s*([\]}])/g, '$1')
        .replace(/(["\d\w\]])\s*\n\s*"/g, '$1,\n"')
        .replace(/}\s*{/g, '},{');
      return JSON.parse(fixed);
    }
  }
}

/**
 * Find the outermost balanced JSON object or array in text.
 * This is more reliable than greedy regex for text mixed with prose.
 */
function findBalancedJSON(text, openChar = '{', closeChar = '}') {
  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.substring(startIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * Extract and parse JSON from text that may contain markdown code blocks.
 */
function parseJSONFromText(text) {
  // Try parsing the whole text first
  try {
    return tryParseJSON(text);
  } catch (e) {
    // Try extracting from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const extracted = jsonMatch[1].trim();
      try {
        return tryParseJSON(extracted);
      } catch (e2) {
        // Try balanced extraction from within the code block
        const balanced = findBalancedJSON(extracted) || findBalancedJSON(extracted, '[', ']');
        if (balanced) {
          try { return tryParseJSON(balanced); } catch (e3) { /* continue */ }
        }
      }
    }
    // Try finding balanced JSON object in the full text
    const balancedObj = findBalancedJSON(text);
    if (balancedObj) {
      try {
        return tryParseJSON(balancedObj);
      } catch (e4) { /* continue */ }
    }
    // Try finding balanced JSON array in the full text
    const balancedArr = findBalancedJSON(text, '[', ']');
    if (balancedArr) {
      try {
        return tryParseJSON(balancedArr);
      } catch (e5) { /* continue */ }
    }
    throw new Error(`Could not parse JSON from Claude response: ${text.substring(0, 500)}...`);
  }
}

module.exports = {
  callClaude,
  callClaudeWithSearch,
  callClaudeJSON,
  callClaudeSearchJSON,
};
