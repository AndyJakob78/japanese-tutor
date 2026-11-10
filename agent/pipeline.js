// Agent Pipeline Orchestrator — Optimized for Speed
// Generates a complete article with vocabulary and quiz in 2 Claude API calls
// + 1 quiz call (parallel with DB save):
//   0. Prefetch ALL Firestore data in parallel (config + articles + vocab)
//   1. News Search (with topic selection built in) — web_search call
//   2. Article + Vocabulary Generation — single combined call
//   3. Quiz Generation + DB save — run in parallel
//
// Prompt caching: system prompts cached for 5 min (faster + cheaper on repeat calls)
// Target: ~25-40 seconds total

const { callClaudeJSON, callClaudeSearchJSON } = require('../server/services/claude');
const { firestore, collections, getNextId } = require('../server/services/firestore');
const { normalizeBody, normalizeWord } = require('./middleware/normalize');
const { runQualityReviewer } = require('./middleware/quality-reviewer');
const { autoFixHallucinatedRomaji } = require('./middleware/wanakana-fix');
const { convertScript, splitLongSentences } = require('./middleware/script-converter');
const { buildNumberCheatSheet } = require('./middleware/numbers-formatter');
const { correctVocabLevels, lookupLevel } = require('./middleware/jlpt-levels');
const { findGiveaways, countProblems, describeProblems } = require('./middleware/quiz-check');
const wanakana = require('wanakana');

/**
 * Load user configuration from Firestore (per-user).
 */
async function loadConfig(userId) {
  const snapshot = await collections.config
    .where('user_id', '==', userId)
    .get();
  const config = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    try {
      config[data.key] = JSON.parse(data.value);
    } catch {
      config[data.key] = data.value;
    }
  }
  return config;
}

// ---- Skill file loader (cached) ----
const fs = require('fs');
const path = require('path');
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const skillCache = {};

function readSkill(skillPath) {
  if (!skillCache[skillPath]) {
    skillCache[skillPath] = fs.readFileSync(path.join(SKILLS_DIR, skillPath), 'utf-8');
  }
  return skillCache[skillPath];
}

// ---- Japanese character detection + cleanup (safety net) ----
// Unicode ranges: Hiragana 3040-309F, Katakana 30A0-30FF, CJK 4E00-9FFF
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

function containsJapaneseChars(text) {
  return JAPANESE_CHAR_REGEX.test(text);
}

/**
 * If the article body contains hiragana/katakana/kanji, call Claude to convert them to romaji.
 * This is a safety net for when the main generation doesn't fully comply.
 */
async function fixJapaneseCharsInBody(body) {
  if (!containsJapaneseChars(body)) return body;

  console.log('[Post-process] Japanese characters detected in body — fixing...');
  const fixed = await callClaudeJSON(
    `You are a text converter. Convert any hiragana, katakana, or kanji in the text to Hepburn romaji with macrons (ā, ī, ū, ē, ō). Keep everything else EXACTLY the same — same words, same [NEW]/[REVIEW] markers, same punctuation, same line breaks. ONLY convert Japanese script characters to romaji. Respond with JSON: {"text":"..."}`,
    `Convert all Japanese characters to romaji in this text:\n\n${body}`,
    { max_tokens: 6144, temperature: 0 }
  );
  return fixed.text || body;
}

// ---- Common word filter (safety net) ----
// Words that should NEVER be marked as [NEW] vocabulary
const COMMON_WORDS = new Set([
  // Particles
  'wa', 'ga', 'wo', 'no', 'ni', 'de', 'to', 'mo', 'ka', 'e', 'ya', 'kara', 'made', 'yo', 'ne', 'na',
  'he', 'ba', 'shi', 'te', 'nado', 'dake', 'shika', 'bakari', 'hodo', 'kurai', 'gurai',
  // Copulas / auxiliaries
  'da', 'desu', 'deshita', 'datta', 'de', 'nai', 'masen',
  // Basic verbs (dictionary + common conjugations)
  'suru', 'aru', 'iru', 'naru', 'iku', 'kuru', 'miru', 'iu', 'omou',
  'shita', 'shite', 'sareta', 'sareru', 'dekiru', 'natta', 'natte',
  'ita', 'iru', 'imasu', 'arimasu', 'shimasu', 'shimashita',
  'itta', 'itte', 'mita', 'kita', 'narimashita',
  'sa', 'se', 'shi', 'su',
  // Pronouns / demonstratives
  'watashi', 'boku', 'kare', 'kanojo', 'karera',
  'kore', 'sore', 'are', 'dore',
  'kono', 'sono', 'ano', 'dono',
  'koko', 'soko', 'asoko', 'doko',
  // Basic conjunctions / adverbs
  'soshite', 'shikashi', 'demo', 'dakara', 'sorede', 'mata',
  'totemo', 'sugoku', 'motto', 'mada', 'yoku', 'chotto',
  // Very basic nouns
  'koto', 'mono', 'toki', 'hito', 'naka', 'ue', 'shita', 'mae', 'ato',
  // Common sentence-enders
  'mashita', 'masu', 'tai', 'rashii', 'sou',
]);

/**
 * Check if a word is too common/basic to be marked as vocabulary.
 */
function isCommonWord(word) {
  if (!word) return false;
  const lower = word.toLowerCase()
    .replace(/[āáà]/g, 'a')
    .replace(/[īíì]/g, 'i')
    .replace(/[ūúù]/g, 'u')
    .replace(/[ēéè]/g, 'e')
    .replace(/[ōóò]/g, 'o');
  return COMMON_WORDS.has(lower);
}

/**
 * Normalize spacing in kanji/kana body text so the iOS whitespace-based
 * [NEW]/[REVIEW] parser works correctly.
 *
 * Problem: natural Japanese has no spaces between words, so Claude may generate:
 *   "ルーマニア人（じん）の[NEW]彫刻家（ちょうこくか）ブランクーシの大規模…"
 * When the iOS renderer splits by whitespace, the entire run becomes one token
 * and [NEW] turns the whole sentence blue instead of just the vocabulary word.
 *
 * Fix: ensure
 *   1. A space before every [NEW] / [REVIEW] marker.
 *   2. A space after every furigana closing ） so each word+furigana is its own token.
 *   3. Collapse any resulting double-spaces.
 */
function normalizeKanjiBodySpacing(body) {
  return body
    // 1. Space before markers if not already there
    .replace(/([^ \t\n])(\[(?:NEW|REVIEW)\])/g, '$1 $2')
    // 2. Space after furigana ） if followed by non-space, non-punctuation, non-closing bracket
    .replace(/）([^\s。、！？…\n\]）「」『』])/g, '） $1')
    // 3. Collapse multiple spaces
    .replace(/  +/g, ' ');
}

/**
 * Strip [NEW] markers from particles and common words in article body text.
 * E.g. "[NEW] wa" → "wa", but "[NEW] keizai" stays as "[NEW] keizai".
 */
function stripMarkersFromCommonWords(body) {
  // Pattern: [NEW] followed by a word — check if the word is common
  return body.replace(/\[NEW\]\s*(\S+)/g, (match, word) => {
    const cleaned = word.replace(/[.,!?;:()"""'']/g, '');
    if (isCommonWord(cleaned)) {
      return word; // Drop the [NEW] marker, keep just the word
    }
    // Check if it looks like a proper noun (starts with uppercase and isn't at sentence start)
    if (/^[A-Z][a-zāīūēō]/.test(cleaned) && cleaned.length > 2) {
      // Might be a proper noun — keep [NEW] only if it's in the newWords list
      // We can't check that here, so leave it for now
    }
    return match; // Keep the marker
  });
}

/**
 * Remove every [NEW]/[REVIEW] marker. Title and summary are plain text — the
 * iOS app only parses markers in the body, so any left there show up raw
 * (e.g. article #190 "OpenAI ni [NEW] saiban").
 */
function stripAllMarkers(text) {
  return text
    .replace(/\[(NEW|REVIEW)\]/g, '')
    // The model sometimes brackets title words itself: "[nedan]ga [a]gatte" (#196).
    // A whole particle after the bracket gets a space; okurigana stays joined.
    .replace(/\](ga|wo|wa|ni|de|no|to|mo|e|ya|kara|made)(?=[\s.,!?]|$)/g, '] $1')
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// =============================================
// QUALITY VALIDATION (runs after generation, before DB save)
// =============================================

/**
 * Validate article quality after generation.
 * All checks are pure string/regex — runs in <1ms, never makes an API call.
 * Returns { valid: boolean, warnings: string[], errors: string[] }
 *   - errors:   serious problems that should block saving (or at least be logged loudly)
 *   - warnings: minor issues that are logged but don't block saving
 */
function validateArticleQuality(article, config) {
  const warnings = [];
  const errors = [];
  const writingSystem = article._writing_system || config.writing_system || 'romaji';

  // 1. Summary length — must be ≤ 12 words AND ≤ 80 characters
  if (article.summary_romaji) {
    const summaryWords = article.summary_romaji.trim().split(/\s+/).length;
    const summaryChars = article.summary_romaji.length;
    if (summaryWords > 12) {
      warnings.push(`Summary too long: ${summaryWords} words (max 12). Summary: "${article.summary_romaji}"`);
    }
    if (summaryChars > 80) {
      warnings.push(`Summary too long: ${summaryChars} chars (max 80). Summary: "${article.summary_romaji}"`);
    }
    // Summary must NOT contain [NEW] or [REVIEW] markers
    if (/\[(NEW|REVIEW)\]/.test(article.summary_romaji)) {
      errors.push(`Summary contains [NEW]/[REVIEW] markers — post-processing should have stripped these.`);
    }
  } else {
    errors.push('Missing summary_romaji field.');
  }

  // 2. Script bleeding — romaji mode should have no hiragana/katakana/kanji in body/title/summary
  if (writingSystem === 'romaji') {
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g;
    const fieldsToCheck = [
      { name: 'title_romaji', value: article.title_romaji },
      { name: 'summary_romaji', value: article.summary_romaji },
      { name: 'body_romaji', value: article.body_romaji },
    ];
    for (const { name, value } of fieldsToCheck) {
      if (!value) continue;
      const matches = value.match(japaneseRegex);
      if (matches) {
        errors.push(`Script bleeding in ${name}: found ${matches.length} Japanese character(s): "${[...new Set(matches)].join('')}"`);
      }
    }
  }

  // 3. Sentence length — each sentence must be ≤ max_sentence_length words
  // Strip [NEW]/[REVIEW] markers before counting to avoid inflating word count
  const maxWords = parseInt(config.max_sentence_length) || 15;
  if (article.body_romaji) {
    const cleanBody = article.body_romaji.replace(/\[(NEW|REVIEW)\]\s*/g, '');
    const sentences = cleanBody.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      const wordCount = trimmed.split(/\s+/).length;
      if (wordCount > maxWords + 5) { // +5 buffer for romaji compound words
        warnings.push(`Long sentence (${wordCount} words, max ~${maxWords}): "${trimmed.slice(0, 60)}..."`);
      }
    }
  } else {
    errors.push('Missing body_romaji field.');
  }

  // 4. [NEW] marker count — should be close to config.new_words_per_article
  const targetNewWords = parseInt(config.new_words_per_article) || 12;
  if (article.body_romaji) {
    const newMarkerCount = (article.body_romaji.match(/\[NEW\]/g) || []).length;
    const diff = Math.abs(newMarkerCount - targetNewWords);
    if (diff > 4) {
      warnings.push(`[NEW] marker count mismatch: found ${newMarkerCount} in body, expected ~${targetNewWords}.`);
    }
  }

  // 5. newWords array — every entry must have the three required fields
  const requiredVocabFields = ['word_romaji_macron', 'meaning_en', 'jlpt_level'];
  const seen = new Set();
  for (const word of (article.newWords || [])) {
    for (const field of requiredVocabFields) {
      if (!word[field]) {
        warnings.push(`Vocabulary word missing required field "${field}": ${JSON.stringify(word)}`);
      }
    }
    // Detect duplicate new words
    if (word.word_romaji_macron) {
      if (seen.has(word.word_romaji_macron)) {
        warnings.push(`Duplicate [NEW] word in newWords array: "${word.word_romaji_macron}"`);
      }
      seen.add(word.word_romaji_macron);
    }

    // Task 4 — Romaji hallucination check: deterministically verify word_romaji_macron
    // matches word_kana using wanakana. Normalise both to plain ASCII (strip macrons, collapse
    // long-vowel spellings) so e.g. "kengō" and "kengo" compare equal.
    if (word.word_kana && word.word_romaji_macron) {
      const normalise = (str) =>
        wanakana.toRomaji(wanakana.toHiragana(str)) // round-trip through kana to normalise
          .replace(/[āīūēō]/g, c => ({ ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' })[c])
          .replace(/[âîûêô]/g, c => ({ â: 'a', î: 'i', û: 'u', ê: 'e', ô: 'o' })[c])
          .replace(/ou|oo/g, 'o')  // long-o variants
          .replace(/uu/g, 'u')     // long-u variants
          .replace(/[^a-z]/g, ''); // strip non-alpha for bare comparison

      const expectedRomaji = normalise(wanakana.toRomaji(word.word_kana));
      const actualRomaji   = normalise(word.word_romaji_macron);

      if (expectedRomaji && actualRomaji && expectedRomaji !== actualRomaji) {
        errors.push(
          `Romaji hallucination: "${word.word_romaji_macron}" does not match kana "${word.word_kana}" ` +
          `(expected ~"${expectedRomaji}", got ~"${actualRomaji}")`
        );
      }
    }
  }

  // 6. newWords array count should roughly match [NEW] markers in body
  const newWordsArrayCount = (article.newWords || []).length;
  if (article.body_romaji && newWordsArrayCount > 0) {
    const newMarkerCount = (article.body_romaji.match(/\[NEW\]/g) || []).length;
    if (Math.abs(newWordsArrayCount - newMarkerCount) > 3) {
      warnings.push(`newWords array (${newWordsArrayCount} entries) vs [NEW] markers in body (${newMarkerCount}) are out of sync.`);
    }
  }

  // 7. Missing title
  if (!article.title_romaji || article.title_romaji.trim().length < 3) {
    errors.push('Missing or very short title_romaji.');
  }

  // 8. Task 2 — Word count enforcement: body must be within 25% of target_word_count.
  // Romaji: count whitespace-separated tokens (strip markers first).
  // Kana/Kanji: count CJK + kana characters as a proxy for "word density".
  const targetWordCount = parseInt(config.target_word_count) || 200;
  if (article.body_romaji) {
    const cleanBody = article.body_romaji.replace(/\[(NEW|REVIEW)\]\s*/g, '').trim();
    let measuredCount;
    if (writingSystem === 'romaji') {
      measuredCount = cleanBody.split(/\s+/).filter(Boolean).length;
    } else {
      // For kana/kanji, count Japanese characters as a word-density proxy
      const jpChars = cleanBody.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || [];
      measuredCount = jpChars.length;
    }
    const deviation = Math.abs(measuredCount - targetWordCount) / targetWordCount;
    if (deviation > 0.25) {
      errors.push(
        `Word count deviation too large: body has ~${measuredCount} ${writingSystem === 'romaji' ? 'words' : 'JP characters'}, ` +
        `target is ${targetWordCount} (${Math.round(deviation * 100)}% off, max 25%).`
      );
    }
  }

  // 9. JLPT level enforcement on [NEW] words.
  // Per the three-tier stratification: every [NEW] word's jlpt_level MUST equal
  // the user's target level — not easier (missed stretch), not harder (above level).
  // Harder than target = ERROR (leaks vocabulary above what the student should see).
  // Easier than target = WARNING (still teachable but Claude under-shot the target).
  const targetLevel = config.proficiency_level;
  const targetLevelIdx = JLPT_ORDER.indexOf(targetLevel);
  if (targetLevelIdx >= 0 && Array.isArray(article.newWords)) {
    let aboveTargetCount = 0;
    let belowTargetCount = 0;
    const aboveSamples = [];
    const belowSamples = [];
    for (const word of article.newWords) {
      if (!word.jlpt_level) continue;
      const wordIdx = JLPT_ORDER.indexOf(word.jlpt_level);
      if (wordIdx < 0) continue; // unknown level string — skip
      if (wordIdx > targetLevelIdx) {
        aboveTargetCount++;
        if (aboveSamples.length < 3) {
          aboveSamples.push(`"${word.word_romaji_macron}" (${word.jlpt_level})`);
        }
      } else if (wordIdx < targetLevelIdx) {
        belowTargetCount++;
        if (belowSamples.length < 3) {
          belowSamples.push(`"${word.word_romaji_macron}" (${word.jlpt_level})`);
        }
      }
    }
    if (aboveTargetCount > 0) {
      errors.push(
        `[NEW] level violation: ${aboveTargetCount} word(s) HARDER than target ${targetLevel} — ` +
        `e.g. ${aboveSamples.join(', ')}. These should be at ${targetLevel} exactly.`
      );
    }
    if (belowTargetCount > 0) {
      warnings.push(
        `[NEW] level under-shoot: ${belowTargetCount} word(s) EASIER than target ${targetLevel} — ` +
        `e.g. ${belowSamples.join(', ')}. Acceptable but missed the stretch.`
      );
    }
  }

  const valid = errors.length === 0;
  return { valid, warnings, errors };
}

// =============================================
// STEP 1: Topic Selection + News Search (combined)
// =============================================
async function searchNewsWithTopic(config, userId, prefetchedArticles, excludeCategories = []) {
  console.log(`[Step 1+2] Searching for news${excludeCategories.length ? ` (excluding: ${excludeCategories.join(', ')})` : ''}...`);

  // Use prefetched data (already sorted) instead of querying Firestore again
  const recentArticles = prefetchedArticles;

  const recentTopics = recentArticles
    .slice(0, 10)
    .map(d => `- "${d.topic}" (${d.region}, category: ${d.category || 'unknown'})`);

  // Build explicit exclusion list from recent article titles/topics
  const recentTitles = recentArticles
    .slice(0, 15)
    .map(d => d.topic || d.title_romaji || '')
    .filter(Boolean);

  // Also collect recently used source URLs to avoid the same news story
  const recentSourceUrls = [];
  for (const art of recentArticles.slice(0, 10)) {
    if (art.sources) {
      for (const src of art.sources) {
        if (src.url) recentSourceUrls.push(src.url);
      }
    }
  }

  // Determine which category and region to suggest next (round-robin)
  // Apply excludeCategories filter — used by the level-retry loop in runPipeline
  // to skip a category that produced an over-level article on a previous attempt.
  const allTopics = config.topics || ['politics', 'technology', 'society'];
  const filtered = excludeCategories.length
    ? allTopics.filter(t => !excludeCategories.includes(t.toLowerCase()))
    : allTopics;
  // Edge case: if exclusion filtered out everything (small config + many failed attempts),
  // fall back to the full list to avoid empty-array crashes.
  const topics = filtered.length > 0 ? filtered : allTopics;
  const regions = config.regions || ['japan', 'germany', 'us'];
  // Check against MORE recent articles for better rotation
  const rotationWindow = Math.max(topics.length, regions.length, 5);
  const recentCategories = recentArticles.slice(0, rotationWindow).map(d => (d.category || '').toLowerCase());
  const recentRegions = recentArticles.slice(0, rotationWindow).map(d => (d.region || '').toLowerCase());

  // Shuffle topics and regions BEFORE the find() call below. Without this,
  // find() always returns the first array element on cold-start (when recent
  // history is empty), permanently biasing the first article toward
  // (topics[0], regions[0]) — e.g. always "germany + ai" for users whose
  // config happens to list those first. Shuffling restores variety even for
  // sparse-history users. (See KNOWLEDGE_HUB.md "rotation bias" note.)
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const shuffledTopics  = shuffle(topics);
  const shuffledRegions = shuffle(regions);

  // If the user provided a custom topic, use it directly; otherwise round-robin
  const customTopic = config.custom_topic || null;
  if (customTopic) {
    console.log(`[News] Custom topic requested: "${customTopic}"`);
  }
  const suggestedTopic = customTopic || shuffledTopics.find(t => !recentCategories.includes(t.toLowerCase())) || shuffledTopics[0];
  // Pick a region that hasn't been used recently
  const suggestedRegion = shuffledRegions.find(r => !recentRegions.includes(r.toLowerCase())) || shuffledRegions[0];

  const newsSourcingSkill = readSkill('news-sourcing/SKILL.md');
  const articleSkill = readSkill('article-generation/SKILL.md');

  // Extract just the topic diversity section from article skill
  const diversitySection = articleSkill.split('## Article Structure')[0] || '';

  const systemPrompt = `You are a news research agent for a Japanese language learning app.
Your job: find ONE specific, interesting current news story. NOT finance/economy unless explicitly requested.

## Source Expertise
${newsSourcingSkill}

## Topic Diversity Rules
${diversitySection}

## IMPORTANT CONSTRAINTS
- The user's interest categories: ${JSON.stringify(topics)}
- The user's regions: ${JSON.stringify(regions)}
${customTopic
  ? `- The user has REQUESTED a specific topic: "${customTopic}". You MUST search for a current news story about this exact topic. Ignore the round-robin category/region rules and find the best story matching their request.`
  : `- You MUST pick category "${suggestedTopic}" and region "${suggestedRegion}" for this article
- If no good story exists for that exact combo, pick a different category from the list — but NEVER default to finance/economy unless it's in the user's topics AND hasn't been used in the last 3 articles`}

## CRITICAL: AVOID DUPLICATE ARTICLES
The user has already read these articles. You MUST find a COMPLETELY DIFFERENT story.
DO NOT write about ANY of these topics or anything closely related:
${recentTitles.map(t => `- "${t}"`).join('\n') || '  (none yet — this is their first article)'}

Recent articles with details:
${recentTopics.join('\n') || '  (none yet)'}

${recentSourceUrls.length > 0 ? `DO NOT use any of these source URLs:\n${recentSourceUrls.map(u => `- ${u}`).join('\n')}` : ''}

If your web search returns a story that matches or overlaps with ANY of the above topics, DISCARD it and search for something else. The user wants VARIETY.

## Output
Respond with ONLY JSON (no markdown):
{
  "topic": "specific story description (not a vague category)",
  "region": "region",
  "category": "the category from the user's topics list",
  "articles": [{"headline":"...","source":"...","url":"...","date":"...","keyFacts":["..."],"numbers":["..."],"quotes":["..."]}],
  "summary": "2-3 sentence overview"
}`;

  const userPrompt = customTopic
    ? `Today: ${new Date().toISOString().split('T')[0]}.
The user specifically requested an article about: "${customTopic}".
Search for a current news story related to "${customTopic}" for a ${config.proficiency_level}-level Japanese learning article.
The article will be written at ${config.proficiency_level} level, so the topic should be understandable at that level.
Find the most interesting and recent story about this topic.`
    : `Today: ${new Date().toISOString().split('T')[0]}.
Find a current ${suggestedTopic} news story from ${suggestedRegion} for a ${config.proficiency_level}-level Japanese learning article.
Remember: pick something SPECIFIC and INTERESTING — a real event, person, or thing. Not a generic economic trend.
The article will be written at ${config.proficiency_level} level, so the topic should be understandable at that level.
CRITICAL: You MUST find a story that is DIFFERENT from any of the user's previous articles listed above. Search for something fresh and new.`;

  // Retry loop for JSON parse failures. Claude's web_search step occasionally
  // returns conversational prose ("I'll search for...", "## Key Finding:" etc.)
  // instead of structured JSON. When that happens, parseJSONFromText throws.
  // We retry up to 2 more times, each with a stronger "JSON ONLY" reminder.
  // (See KNOWLEDGE_HUB.md "search JSON failures" note.)
  const MAX_SEARCH_ATTEMPTS = 3;
  let result;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    try {
      const promptForAttempt = attempt === 1
        ? userPrompt
        : `🛑 YOUR PREVIOUS RESPONSE WAS NOT VALID JSON. ` +
          `Output ONLY a single JSON object matching the schema in the system prompt. ` +
          `NO preamble, NO markdown, NO commentary, NO "I'll search for..." text. ` +
          `Start your response immediately with { and end with }.\n\n` +
          userPrompt;
      const parsed = await callClaudeSearchJSON(systemPrompt, promptForAttempt, {
        // Sonnet 5.5's web_search_20260209 issues several queries per search
        // pass (dynamic filtering); 3 ran out → "usage limit exceeded" → empty
        // results. 8 gives it room; each search is ~$0.01.
        max_searches: 8,
        max_tokens: 4096,
      });

      // Validate the parsed result — it can parse as valid JSON yet be empty or
      // missing required fields (we saw topic:"undefined", articles:[] slip
      // through, which then crashed the pipeline with "No news articles found"
      // and hung the request). Treat that as a retryable failure, same as a
      // parse error.
      const hasArticles = Array.isArray(parsed?.articles) && parsed.articles.length > 0;
      const hasTopic = parsed?.topic && parsed.topic !== 'undefined' && String(parsed.topic).trim();
      if (!hasArticles || !hasTopic) {
        lastErr = new Error(`Search returned no usable articles (topic=${parsed?.topic}, articles=${parsed?.articles?.length || 0})`);
        if (attempt < MAX_SEARCH_ATTEMPTS) {
          console.warn(`[Step 1+2] ⚠️  Search parsed but had no usable articles (attempt ${attempt}/${MAX_SEARCH_ATTEMPTS}). Retrying.`);
          result = undefined;
          continue;
        }
        throw lastErr; // out of attempts — fail cleanly (caught by route → 500)
      }

      result = parsed;
      if (attempt > 1) {
        console.log(`[Step 1+2] ✅ Search succeeded on attempt ${attempt}/${MAX_SEARCH_ATTEMPTS}`);
      }
      break;
    } catch (err) {
      lastErr = err;
      const retryable = err.message?.includes('Could not parse JSON')
                     || err.message?.includes('no usable articles');
      if (retryable && attempt < MAX_SEARCH_ATTEMPTS) {
        console.warn(`[Step 1+2] ⚠️  Search failed (${err.message?.slice(0, 60)}) — attempt ${attempt}/${MAX_SEARCH_ATTEMPTS}. Retrying with stronger JSON-only prompt.`);
        continue;
      }
      throw err; // non-retryable or final-attempt errors bubble up
    }
  }
  if (!result) throw lastErr || new Error('News search failed after retries');

  console.log(`[Step 1+2] Topic: "${result.topic}" (${result.region})`);
  console.log(`[Step 1+2] Found ${result.articles?.length || 0} articles`);
  return result;
}

// =============================================
// STEP 2: Article + Vocabulary Generation (combined)
// =============================================
/**
 * Build writing-system-specific prompt sections.
 * Returns { skillText, writingInstructions, userRules } for the selected system.
 */
function getWritingSystemPrompt(writingSystem, config) {
  if (writingSystem === 'kana') {
    const kanaSkill = readSkill('kana-standards/SKILL.md');
    return {
      skillText: kanaSkill,
      skillHeader: 'Kana Rules',
      systemIntro: `You write Japanese learning articles in hiragana and katakana (no kanji, no romaji) and extract vocabulary.

CRITICAL — KANA MODE: The title_romaji, summary_romaji, and body_romaji JSON fields must ALL be written in hiragana/katakana. The field names are misleading — ignore the word "romaji" in them. Every character of the title, summary, and article body must be hiragana or katakana. NO romaji, NO kanji anywhere in those three fields.`,
      userRules: `Hiragana + katakana only — NO romaji, NO kanji in title, summary, or body. Add spaces between words. Max ${config.max_sentence_length} words per sentence. Exactly ${config.new_words_per_article} [NEW] words. Level: ${config.proficiency_level}. Include 1-2 grammar points. Also extract full vocabulary metadata for each [NEW] and [REVIEW] word.`,
    };
  } else if (writingSystem === 'kanji') {
    const kanjiSkill = readSkill('kanji-standards/SKILL.md');
    return {
      skillText: kanjiSkill,
      skillHeader: 'Kanji + Furigana Rules',
      systemIntro: `You write Japanese learning articles using kanji with furigana and extract vocabulary. Every kanji gets furigana in full-width parentheses: 経済（けいざい）.

CRITICAL — KANJI MODE: The title_romaji, summary_romaji, and body_romaji JSON fields must ALL be written in kanji+furigana. The field names are misleading — ignore the word "romaji" in them. The title and summary must be in Japanese (kanji with furigana), NOT in romaji. Write the full article — title, summary, and body — in kanji+furigana. NO romaji in those three fields.

HOMOPHONE DISAMBIGUATION — choose the right kanji based on context:
- kagaku → 化学 (chemistry — manufacturing/materials/space) vs 科学 (science — abstract/theory)
- taishō → 対象 (target — users/audience/contracts) vs 対照 (control — data/experiments) vs 対称 (symmetry — UI/physics)
- bunka → 文化 (culture — sociology) vs 分科 (subcommittee — corporate/project context); if neither fits a business context, double-check whether 分類 (bunrui — category) was intended
- jōkyō (状況 — status, for progress reports) vs jōken (条件 — requirements, for contracts/specs) — pick by intent
Always pick the kanji that matches the surrounding semantic context of the news story.`,
      userRules: `Kanji + furigana in full-width parentheses — NO romaji in title, summary, or body. Use kanji at or below ${config.proficiency_level} level. Add spaces between phrases. Max ${config.max_sentence_length} words per sentence. Exactly ${config.new_words_per_article} [NEW] words. Level: ${config.proficiency_level}. Include 1-2 grammar points. Also extract full vocabulary metadata for each [NEW] and [REVIEW] word.`,
    };
  } else {
    // Default: romaji
    const romajiSkill = readSkill('romaji-standards/SKILL.md');
    return {
      skillText: romajiSkill,
      skillHeader: 'Romaji Rules',
      systemIntro: `You write Japanese learning articles in Hepburn romaji and extract vocabulary.

CRITICAL CHARACTER CONSTRAINT — ROMAJI MODE:
The title_romaji, summary_romaji, and body_romaji fields may ONLY contain:
  • Lowercase a–z letters
  • Macron vowels: ā ī ū ē ō (Hepburn long vowels — REQUIRED, never write "ou" or "oo")
  • Spaces and standard punctuation: . , ! ? : ; ' " - ( )
  • [NEW] and [REVIEW] markers exactly as written
  • Numbers (0–9) when quoting facts from the news

ANY hiragana (あ–ん), katakana (ア–ン), or kanji (漢字) in those three fields = FAILED OUTPUT.
Do not include Japanese script anywhere in the article — it belongs ONLY in vocabulary metadata fields (word_kana, word_kanji).`,
      userRules: `Hepburn romaji only — NO hiragana/katakana/kanji in the article body, title, or summary. Max ${config.max_sentence_length} words per sentence. Exactly ${config.new_words_per_article} [NEW] words. Level: ${config.proficiency_level}. Include 1-2 grammar points. Also extract full vocabulary metadata for each [NEW] and [REVIEW] word.`,
    };
  }
}

// =============================================
// CONDITIONAL LLM JUDGE (script-bleeding correction)
// =============================================

/**
 * Targeted correction pass triggered ONLY when validateArticleQuality() reports
 * script-bleeding errors in romaji mode AFTER normal post-processing has already run.
 *
 * Design decisions:
 * - Uses the same model as the rest of the pipeline (currently Haiku) — fast and cheap.
 * - temperature: 0 — we want deterministic conversion, not creative rewriting.
 * - Non-fatal: if the call fails or times out, the original article is returned unchanged.
 *   A slightly imperfect article is always better than a crashed pipeline.
 * - Rewrites all three fields together in one call so the judge has full context and
 *   keeps title/summary/body internally consistent.
 */
async function runScriptBleedingJudge(article) {
  console.log('[Judge] Script bleeding detected after post-processing — triggering correction pass...');
  try {
    const judgeResult = await callClaudeJSON(
      `You are a strict text corrector for a Japanese language learning app.
Your ONLY task: find every hiragana, katakana, or kanji character in the three article fields below and replace each one with its correct Hepburn romaji equivalent.

RULES — follow precisely:
1. Convert Japanese script (hiragana あ–ん, katakana ア–ン, kanji 漢字) to Hepburn romaji.
2. Long vowels MUST use macrons: ā ī ū ē ō — NEVER write "ou", "oo", or "uu".
3. Keep ALL [NEW] and [REVIEW] markers exactly as written — do not move or remove them.
4. Keep all punctuation, numbers, spaces, and non-Japanese text completely unchanged.
5. Do NOT rephrase, reorder, or change the meaning of any sentence.
6. Japanese script belongs ONLY in vocabulary metadata — never in the article text.

Respond with ONLY valid JSON and nothing else (no markdown fences, no explanation):
{"title_romaji":"...","summary_romaji":"...","body_romaji":"..."}`,
      `Fix all Japanese characters in these three fields:\n\ntitle_romaji: ${article.title_romaji}\n\nsummary_romaji: ${article.summary_romaji}\n\nbody_romaji: ${article.body_romaji}`,
      { max_tokens: 6144, temperature: 0 }
    );

    // Only apply a field if the judge returned a non-empty value — never blank a field on error
    if (judgeResult.title_romaji)   article.title_romaji   = judgeResult.title_romaji;
    if (judgeResult.summary_romaji) article.summary_romaji = judgeResult.summary_romaji;
    if (judgeResult.body_romaji)    article.body_romaji    = judgeResult.body_romaji;

    console.log('[Judge] Correction pass applied.');
  } catch (err) {
    // Non-fatal — log loudly and return original article unchanged
    console.error('[Judge] Correction pass failed — saving original article as-is:', err.message);
  }
  return article;
}

// JLPT levels ordered easiest → hardest. Used to compute "tier below target"
// for the three-tier vocabulary stratification in the article prompt.
const JLPT_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];

async function generateArticleWithVocab(newsData, config, userId, prefetchedKnownWords) {
  // ARCHITECTURE (KNOWLEDGE_HUB Option A):
  // Claude ALWAYS generates in kanji+furigana — its strongest, lowest-hallucination
  // output mode. We deterministically convert to the user's preferred writing
  // system AFTER generation, using the kana embedded in furigana as ground truth.
  // This eliminates ~all Class A romaji hallucinations.
  const userWritingSystem = config.writing_system || 'romaji';
  const writingSystem = 'kanji'; // internal generation mode (always kanji+furigana)
  console.log(`[Step 3+4] Generating article (internal=kanji+furigana, output=${userWritingSystem})...`);

  // Use prefetched vocabulary instead of querying Firestore again
  const knownWords = prefetchedKnownWords;

  // Compute "easier than target" levels for the background-vocabulary tier.
  // N3 → "N5, N4"; N4 → "N5"; N5 → "N5" (degenerate — no easier tier exists).
  const targetIdx = JLPT_ORDER.indexOf(config.proficiency_level);
  const easierLevels = targetIdx > 0
    ? JLPT_ORDER.slice(0, targetIdx).join(', ')
    : 'N5';
  const isN5User = targetIdx <= 0;

  const wsPrompt = getWritingSystemPrompt(writingSystem, config);
  const articleSkill = readSkill('article-generation/SKILL.md');
  // Load the curated glossary (KNOWLEDGE_HUB Option B) — pre-vetted Japanese
  // terms for tech/business/government concepts. Injected to prevent the most
  // common semantic word-choice errors (kumo vs kuraudo, 税務省 vs 財務省, etc.).
  const glossarySkill = readSkill('glossary/SKILL.md');

  // Deterministically pre-compute Japanese forms for any currency amounts in
  // the source (see agent/middleware/numbers-formatter.js). Prevents the
  // "$2.6 billion → 450 doru" class of factual error — Claude copies the exact
  // form instead of doing 万/億/兆 arithmetic it gets wrong.
  const numberCheatSheet = buildNumberCheatSheet(newsData);

  const newsContext = (newsData.articles || []).map(a =>
    `${a.source}: ${a.headline}. Facts: ${(a.keyFacts || []).join('; ')}. Numbers: ${(a.numbers || []).join(', ')}`
  ).join('\n');

  const systemPrompt = `${wsPrompt.systemIntro}

## Article Writing Expertise
${articleSkill}

## ${wsPrompt.skillHeader}
${wsPrompt.skillText}
${numberCheatSheet ? `\n${numberCheatSheet}\n` : ''}
## 🎯 DOMAIN CONTEXT (use for disambiguation)

This article's domain is: **${newsData.category || 'general news'}** (region: ${newsData.region || 'unspecified'}).
When a Japanese reading is ambiguous between multiple kanji, PREFER the interpretation that fits this domain. Example: in an automotive/SDV or electronics article, きょうでん is more likely the company/proper-noun than the technical term 強電 (high-voltage) — but see the proper-noun rule below.

## 🏷️ CRITICAL: Proper Nouns Stay as Names (never semantic kanji)

Company names, product names, person names, and brand names from the source MUST be rendered as **katakana** or kept in their **original Latin spelling** — NEVER converted into semantic kanji.

- ✅ Kyoden Co. → キョーデン (katakana) or "Kyoden" — NOT 強電 (that means "high-voltage"!)
- ✅ Cohere → Cohere (Latin) or コヒア (katakana)
- ✅ SoftBank → ソフトバンク or "SoftBank"
- ✅ Watanabe (person) → ワタナベ or 渡辺（わたなべ） if the source gives the kanji
- ❌ NEVER pick semantic kanji for a company name just because the reading matches a real word.

A proper noun can never collide with a technical term if it stays katakana/Latin. When unsure whether something is a company name or a common word, treat it as a proper noun (katakana) — it's the safer choice.

## 📖 AUTHORITATIVE GLOSSARY — Use these standard Japanese terms

${glossarySkill}

## CRITICAL: Natural Word Choice (no native-word/loanword mix-ups)

Japanese strongly prefers KATAKANA LOANWORDS for foreign tech, business, and product concepts. Picking the native Japanese word for these creates jarringly wrong articles. Follow this table strictly:

| Concept | Use this (loanword) | NEVER use this (native word) |
|---|---|---|
| cloud computing | kuraudo (クラウド) | kumo (雲, "clouds in sky") |
| earbuds, headphones | iyahon (イヤホン) | mimikaki (耳かき, "earpick") |
| computer | konpyūtā / PC | keisanki (計算機, archaic) |
| email | mēru (メール) | denshi-yūbin |
| mobile app | apuri (アプリ) | sōfuto |
| online chat | chatto (チャット) | — |
| AI / machine learning | AI / kikai-gakushū | — |
| smartphone | sumaho (スマホ) | keitai-denwa (slightly old) |
| download | daunrōdo (ダウンロード) | — |

## CRITICAL: Modern Vocabulary Only

Tech/business articles must use STANDARD MODERN Japanese. Reject archaic or literary forms:

| Avoid (archaic/literary) | Use instead |
|---|---|
| wakatsu (分つ, archaic "to divide") | wakeru (分ける) or shikibetsu suru (識別する) |
| nasu (なす, archaic "to do") | suru (する) or okonau (行う) |
| iukotonaki | mondai no nai or hijō ni yoi |

## CRITICAL: Counter Words Must Match What They Count

- **Software commands, kinds, varieties** → -shurui (種類). Example: nijū-shurui no komando (20 kinds of commands).
- **Physical small items (microphones, sensors, buttons)** → -ko (個). Example: hachi-ko no maiku (8 microphones).
- **People** → -nin (人).
- **Long thin items** → -hon (本).

Numbers when used as counters: NEVER elongate. ni (2), san (3), yon (4) keep short vowels. Write \`ni-ko\` NOT \`nī-ko\`.

## CRITICAL: Factual Accuracy — Stay Close to the Source

You will be given source news facts in the user prompt. Your article MUST stay faithful to those facts:

- Do NOT invent details (features, locations, numbers) not in the source.
- Do NOT misstate company nationality, product purpose, or factual claims.
- If the source says a company is making a chip IN Germany but it's not a German company, write that carefully — "X-company ga Doitsu de tsukurimashita" (made it in Germany) NOT "Doitsu no X-company" (German X-company).
- If unsure, REWORD to avoid the claim rather than guess.

## CRITICAL: Watch for Phonetic-Slip Real Words

Common Claude slips where the wrong real word is chosen because it sounds similar:

| Often-wrong | Probably means |
|---|---|
| kyūshoku (給食, school lunch) | kyūsoku (急速, rapid) — esp. near jūden (charging) |
| sekkai (切開, surgical incision) | sekai (世界, world) |
| kumo (雲, sky clouds) | kuraudo (クラウド, cloud computing) — see loanword table |
| Doitsu (Germany) | dokuji (独自, proprietary/original) — check context |
| kaishū (回収, recall/collection) | baishū (買収, acquisition/M&A) — for "acquires/buys" |

If your draft contains any of the LEFT column words, double-check the surrounding context and switch to the RIGHT column if appropriate.

## CRITICAL: Consonant-Shift Business Terms (M&A / Finance)

For business and finance contexts, these voiced/unvoiced pairs change meaning DRASTICALLY:

| Right (for M&A context) | Wrong (different meaning) |
|---|---|
| baishū (買収, acquisition/buyout) | kaishū (回収, recall/collection) |
| tōshi (投資, investment) | dōshi (動詞, verb) |
| haitō (配当, dividend) | gaitō (該当, applicable) |

If the source headline says "acquires", "buys", "M&A", the Japanese MUST be **baishū** (買収). Never kaishū.

## CRITICAL: Currency Amount Naming (Large Numbers)

When writing currency amounts in romaji, use the correct Japanese number multiplier:

| English | Japanese multiplier | Example |
|---|---|---|
| Thousand | sen (千) | sen-en = 1,000 yen |
| 10,000 (myriad) | man (万) | hyaku-man-en = 1,000,000 yen |
| 100 million | oku (億) | hyaku-oku-en = 10B yen |
| **1 billion** | **jū-oku (十億)** | **jū-oku yūro = 1 billion euros** |
| 1 trillion | chō (兆) | itchō-en = 1T yen |

NEVER write "ichi-gyaku" (not a word!), "ichi-bilion" (not Japanese), or invent new number words. €1 billion = \`jū-oku yūro\`. $30 million = \`san-zen-man doru\`. €100M = \`ichi-oku yūro\`.

## CRITICAL: AI / Machine Learning Verbs (subject-aware!)

The verb you choose depends on whether the SUBJECT is HUMAN or MACHINE.

### When subject is AI / model / machine

| Right (for AI/machine) | Wrong (human-only) |
|---|---|
| gakushū suru (学習する, learn / be trained) | benkyō suru (勉強する, study at school) |
| gakushū suru (学習する) | kunren suru (訓練する, train a person) — for AI, gakushū is preferred |
| shori suru (処理する, process) | kangaeru (考える, think) |
| handan suru (判断する, judge/decide) | omou (思う, feel/think personally) |
| kinō suru (機能する, function) | hataraku (働く, human labor) |

Example: "AI ga dēta wo **gakushū** suru" ✓ (AI learns from data)
NOT:     "AI ga benkyō suru" ✗ (school-study verb for AI)
NOT:     "AI no **kunren** ni dēta wo tsukau" ✗ (training-a-human verb for AI)

### When subject is a HUMAN / government / person

Don't apply the AI rules backward — humans DO use benkyō and kentō:

| Right (for humans) | Don't substitute to |
|---|---|
| benkyō suru (勉強する, study) | gakushū suru (would mean human is a ML model — nonsensical) |
| kentō suru (検討する, examine carefully) | gakushū suru |
| manabu (学ぶ, learn) | gakushū suru (gakushū = formal machine context) |

Example: "Seifu wa anzen ni tsuite motto **benkyō** suru hitsuyō ga aru" ✓ (gov't needs to study safety)
NOT:     "Seifu wa anzen ni tsuite motto **gakushū** suru hitsuyō ga aru" ✗ (gov't isn't an ML model)

## CRITICAL: News Register (Formal vs Casual)

News articles use formal Japanese. Replace casual / childish phrasings:

| Casual / childish | Formal news |
|---|---|
| yori mo ōku (more than) | ijō (以上) — esp. for numbers: "300-man-kai ijō" |
| sugoi | totemo / hijō ni |
| yappari | yahari |
| chotto | sukoshi |
| -te kureru (favor-recv) | -shite imasu / -sareru |

## CRITICAL: Founder Terminology

For startup / business contexts, prefer **sōgyōsha** (創業者, business founder).
\`sōsetsusha\` (創設者) is fine for non-profits and institutions but sounds slightly off for a commercial startup acquisition.

## CRITICAL: Sentiment-Aware Word Choice (don't accidentally call good news bad)

Several common Japanese words have strong sentiment connotations. Pick wisely based on whether the news is positive, neutral, or negative.

| Wrong (negative connotation) | Right (neutral/positive) | Context |
|---|---|---|
| mondai (問題, problem) | moderu (モデル, model) or rei (例, example) | "success model" not "success problem" |
| jiken (事件, crime/scandal/incident) | dekigoto (出来事, event) or nyūsu (ニュース) | For non-crime news. Jiken implies someone is going to jail. |
| jiko (事故, accident) | dekigoto (出来事) | Same — jiko implies harm |
| shippai (失敗, failure) | kadai (課題, challenge) | When framing setbacks |

**Specific example to avoid**: A €1B acquisition is GOOD news. Never write "kono torihiki wa ... seikō no mondai" ("this deal is a problem for success"). Write "seikō no moderu" or "seikō-rei" (success story/example).

For corporate M&A and business news: an acquisition or large investment is an **ōkina dekigoto** (major event), NOT an **ōkii jiken** (major scandal).

## CRITICAL: Loanword Consistency Within the Article

If the article already uses a standard Japanese term for a concept, do NOT switch to an awkward English-katakana loanword later in the same article. Pick one and stick with it.

| If you've used... | Don't also use... |
|---|---|
| baishū (買収, acquisition) | akuishishon (アクイジション) — Japanese news never says this; M&A is the alternative |
| kaihatsu (開発, development) | deberoppumento (デベロップメント) |
| seichō (成長, growth) | gurōsu (グロース) |
| kaisha (会社, company) | kanpanī (カンパニー) |

Standard Japanese business terms beat awkward English transliterations in news writing. The exception: when the English term IS the standard (e.g. AI, IoT, M&A, GDP).

## CRITICAL: AI Naming — Correct Hepburn

人工知能 (AI) in romaji is **\`jinkō-chinō\`** — long ō on BOTH syllables, never on the second-to-last \`i\`.
- ❌ \`jinkō-chīno\` (long i on the wrong syllable)
- ❌ \`jinkou-chinou\` (missing macrons)
- ❌ \`jinkō-chino\` (missing second macron)
- ✅ \`jinkō-chinō\`

## CRITICAL: Subject Clarity (no dangling subjects)

Japanese \`~te\` form chains share the subject of the topic (wa). If subjects change mid-sentence, SPLIT into two sentences. Don't chain.

❌ WRONG: "Kono kaisha wa Fureiburugu ni atte, jū-oku yūro wo tōshi suru yotei desu."
   (Implies the SAME company is both located in Freiburg AND investing 1B euros.)

✅ RIGHT: "Prior Labs wa Fureiburugu ni arimasu. SAP wa jū-oku yūro wo tōshi suru yotei desu."
   (Two clear subjects, no ambiguity.)

When two clauses have different subjects, NEVER use te-form to chain them. Use two sentences with explicit \`wa\` topics.

## CRITICAL: Entity Tracking (no repetitive "kaisha")

Once you've named an organization, REUSE its proper name — do not fall back to generic "kaisha" (the company) over and over. Repetitive generic nouns read as robotic.

- ✅ "Amazon wa Zoox wo kaimashita. Zoox wa jidō-unten no gijutsu wo tsukutte imasu. Amazon wa kono gijutsu wo tsukau yotei desu."
- ❌ "Kaisha wa betsu no kaisha wo kaimashita. Sono kaisha wa gijutsu wo tsukutte imasu. Kaisha wa ..." (which company is which?)

Establish each entity by name once, then keep referring to it by that name (Amazon, Zoox, SAP, etc.). Use "kaisha" only for a genuinely unnamed/general company. Keep the narrative in chronological order and in polite desu/masu form.

## CRITICAL: Corporate Verb Choice (stay within JLPT scaffolding)

For corporate actions and stances, prefer these N4–N5 verb choices that sound more business-appropriate without exceeding the user's level:

| Less natural for corp | More natural for corp | Both within N3 budget |
|---|---|---|
| omotte imasu (思う, personal feeling) | kangaete imasu (考える, logical position) | ✓ |
| dekita (出来た, was made — childish for companies) | sōgyō shita (創業した, was founded) | sōgyō is N3 — use as [NEW] |
| chiisai kaisha (small company) | sutātoappu (スタートアップ, startup) | loanword — always allowed |
| kigyō yō (for companies) | kigyō-muke (企業向け, enterprise-facing) | same level |
| hataraku (働く, human work) | kinō suru (機能する, function) | kinō is N3 — preference, not required |

**DO NOT upgrade to these N2 words** (would violate the user's N3 scaffolding):
- ❌ ōte (大手, major company) — N2
- ❌ setsuritsu (設立, establishment) — N2
- ❌ shinkō (新興, emerging) — N2

Stick to the N4–N5–N3 swaps above. If the news story would normally use an N2 word, REWORD to stay within scope.

## CRITICAL: Word Count
The article body MUST contain EXACTLY ${config.target_word_count || 200} ${writingSystem === 'romaji' ? 'words' : 'Japanese characters'} — no more, no less (±10% tolerance only).
IMPORTANT: [NEW] and [REVIEW] markers do NOT count as words. Count only the actual content words in the body.
After writing, count your words carefully and adjust before responding.
The "word_count" field must equal the actual content word count (excluding markers).

## CRITICAL: JLPT Level Stratification (target = ${config.proficiency_level})

This article uses THREE vocabulary tiers. Treat them as distinct — do not mix.

1. BACKGROUND vocabulary (everything that isn't marked [NEW] or [REVIEW]):
   ${isN5User
     ? `Use only N5 vocabulary — this is the easiest level, so background and new words share the tier.`
     : `🛑 **STRICTLY one tier below ${config.proficiency_level} — use ONLY ${easierLevels} words for filler.**
   Do NOT use ${config.proficiency_level} words for background. ${config.proficiency_level} vocabulary belongs in the [NEW] or [REVIEW] markers only.
   ⚠️ Common N3 words that LEAK into N4 background and MUST be replaced or marked [NEW]:
   - 政府 (seifu) → use 国 (kuni, country) for background
   - 建物 (tatemono) → use 家 (ie, house) or ビル (biru, building)
   - 人口 (jinkō) → use 人の数 (hito no kazu)
   - 政策 (seisaku) → use ルール (rūru, rule)
   - 環境 (kankyō) → use 自然 (shizen) or simply まわり (mawari)
   - 経済 (keizai) → use お金 (okane)
   - 開発 (kaihatsu) → use 作る (tsukuru, make)
   - 暖房 (danbō) → use ヒーター (hītā) or simpler description
   - 対策 (taisaku) → use 方法 (hōhō, method) — N4
   - 技術 (gijutsu) → only as [NEW] for N4+ users
   If a concept genuinely requires an N3 word, MARK IT [NEW]. Don't sneak it in as background.`}

2. [NEW] words — exactly ${config.new_words_per_article} of them:
   Every single [NEW] word MUST be at ${config.proficiency_level} (the target level).
   Not easier, not harder. These are the "stretch" words the student is learning this article.
   The jlpt_level field on each newWords entry MUST equal "${config.proficiency_level}".
   TITLE RULE: keep title words at or below ${config.proficiency_level} where possible. If the story's key word is unavoidably above level (e.g. 合併 in a merger story, 辞任 in a resignation story), it MUST be one of the [NEW] words, appear in newWords with its TRUE jlpt_level, and be explained with つまり in the body — never leave the story's key word unexplained.

3. [REVIEW] words — pulled from the user's known-words list (provided in the user prompt):
   Actively reuse words the student has ALREADY learned and mark each one with [REVIEW] in the body.
   Target ~5-8 review words per article. If the user's known-words list has fewer available, use whatever IS there — do NOT invent new ones or repeat the same word multiple times to hit a target.
   Review words MAY be at ${config.proficiency_level} (the student already learned them) — this is the only exception to rule 1.

🛑 **Sentences must be max ${config.max_sentence_length} words — HARD LIMIT.** Count each romaji word (space-separated) before finishing a sentence. If a sentence exceeds the limit, SPLIT it with a period. This is enforced by an automated check that will trigger regeneration if violated.
NEVER use vocabulary harder than ${config.proficiency_level}. If the news topic forces a harder concept, simplify it.

## 🚫 CRITICAL: GRAMMAR CEILING (never exceed ${config.proficiency_level} grammar)

Use ONLY grammar structures at ${config.proficiency_level} or EASIER. LLMs naturally drift into higher-level grammar when writing about business/technology — actively SUPPRESS this. If a sentence's grammar feels "too simple" for a news article, you are doing it RIGHT.

Common higher-level structures that LEAK into articles — use the simple replacement instead (block anything ABOVE ${config.proficiency_level}):

| Avoid (level) | Use instead (N4/N5) |
|---|---|
| ~において / ~における (N3, "in/at") | ~で |
| ~によって / ~により (N3, "by/due to") | ~で |
| ~に対して (N3, "toward") | ~に |
| ~に関して / ~に関する (N3, "regarding") | ~について |
| ~にとって (N3, "for") | ~には |
| ~として (N3, "as") | rephrase simply |
| ~をめぐって (N2, "concerning") | ~について |
| ~に伴って (N2, "along with") | ~と一緒に / ~ので |
| ~つつある (N2, "in the process of") | ~ている |
| ~ものの (N2, "although") | ~が / ~けど |
| ~を通じて (N2, "through") | ~で |
| ~ざるを得ない (N1, "cannot help but") | ~なければならない (N4) |
| ~ゆえに (N1, "therefore") | だから (N5) |
| ~べく / ~べき (N1/N2) | ~ため / ~ほうがいい |

For lower-level users the ceiling is even stricter (an N4 user gets no N3 grammar; an N3 user gets no N2 grammar; etc.). When in doubt, choose the SIMPLER structure.

## CRITICAL: Precise Terms, Not Awkward Literals (within the level ceiling)

Use the PROPER industry-standard term for a concept — never an unnatural literal paraphrase. BUT the level ceiling still applies: the term must be at or below ${config.proficiency_level}, OR be a katakana loanword (loanwords carry no JLPT level and are always allowed for tech/business).

| ✅ Correct (standard term) | ❌ Wrong (awkward literal) |
|---|---|
| リコール (rikōru — recall) | yobi modosu |
| センサー (sensā) | kanchi suru kikai |
| データ (dēta) | jōhō no kazu |
| アプリ (apuri) | keitai no sofuto |

If the ideal standard term is ABOVE the user's level (e.g. 現場 genba is N3, 検知 kenchi is N2), do NOT use it for a lower-level user and do NOT invent baby-talk. Instead use a katakana loanword if one exists, or a clean at-level rephrase. Precision within the ceiling — never break the ceiling for precision.

## CRITICAL: "Budget & Define" — explain professional terms inline

You may use up to **1–2 advanced/professional [NEW] terms per paragraph** (at the user's level — never above). Each time you introduce one, IMMEDIATELY follow it with a brief plain-language explanation so a ${config.proficiency_level} reader understands it.

Deliver the explanation as a natural follow-up clause using **つまり (tsumari, "that is")** or **という意味 (to iu imi, "means")** — NEVER in parentheses （）, which are reserved for furigana and would break the text.

- ✅ 政府（せいふ）は 対策（たいさく）を 発表（はっぴょう）しました。つまり、問題（もんだい）を 直（なお）す 方法（ほうほう）です。
   ("The government announced a taisaku. That is, a way to fix the problem.")
- ❌ 対策（たいさく）（問題を直す方法） ← parentheses collide with furigana, DO NOT do this.

Keep each gloss short (one simple clause). Do not gloss basic words — only the 1–2 professional terms per paragraph.

## CRITICAL: [NEW] Marker Rules
[NEW] marks vocabulary words the student is LEARNING for the first time. Only mark words that are genuinely useful vocabulary.

NEVER mark these with [NEW]:
- Particles (wa, ga, wo, no, ni, de, to, mo, ka, etc.)
- Copulas / auxiliaries (da, desu, deshita, datta, de aru)
- Basic verbs the student already knows (suru, aru, iru, naru, iku, kuru, miru, iu, omou, dekiru)
- Pronouns (watashi, boku, kare, kanojo, kore, sore, are, dore, koko, soko)
- Basic conjunctions (soshite, shikashi, demo, dakara, sorede, mata)
- Basic adverbs (totemo, sugoku, motto, mada, yoku, chotto)
- Numbers, counters, dates
- Proper nouns / names: people, companies, countries, cities, organizations
- Loanwords that are just English with katakana pronunciation
- Words already in the known words list

ONLY mark with [NEW]: Meaningful Japanese vocabulary words AT EXACTLY ${config.proficiency_level} level that teach the student something new (nouns, verbs, adjectives, useful adverbs, compound words). Not easier, not harder — exactly at the target level.

[REVIEW] markers go on words from the user's known-words list ONLY — never on a word the student hasn't been exposed to before. If the known-words list is empty or very small, use fewer [REVIEW] markers — do NOT fabricate review candidates.

Similarly, do NOT put particles, proper nouns, or basic grammar words in the newWords or reviewWords arrays.

The summary_romaji field must NOT contain [NEW] or [REVIEW] markers — it is plain text. It must be max 80 characters / 12 words (it needs to fit on a small phone screen without truncation). Write it in the same script as the rest of the article (${writingSystem === 'romaji' ? 'romaji' : writingSystem === 'kana' ? 'hiragana/katakana' : 'kanji+furigana'}).

IMPORTANT: The vocabulary metadata (newWords, reviewWords) must ALWAYS include word_romaji_macron, word_kana, and word_kanji fields regardless of writing system. These are needed for the vocabulary bank.

Respond with ONLY JSON:
{
  "title_romaji": "${writingSystem === 'romaji' ? 'title in romaji' : writingSystem === 'kana' ? 'タイトル in kana' : 'タイトル（ふりがな）in kanji+furigana'}",
  "summary_romaji": "${writingSystem === 'romaji' ? '1 short sentence in romaji' : writingSystem === 'kana' ? '1 short sentence in kana' : '1 short sentence in kanji+furigana'}, max 80 chars / 12 words, NO markers",
  "body_romaji": "article with [NEW] and [REVIEW] markers in ${writingSystem === 'romaji' ? 'romaji' : writingSystem === 'kana' ? 'kana' : 'kanji+furigana'}",
  "translation_en": "English translation",
  "grammar_points": [{"pattern":"...","level":"N3","explanation":"...","examples":["..."]}],
  "sources_cited": ["source 1"],
  "word_count": 200,
  "new_word_count": 12,
  "newWords": [{"word_romaji":"...","word_romaji_macron":"...","word_kanji":"...","word_kana":"...","meaning_en":"...","part_of_speech":"noun/verb/adj","jlpt_level":"N3","category":"general","context_sentence":"..."}],
  "reviewWords": [{"word_romaji_macron":"...","word_kana":"...","word_kanji":"...","meaning_en":"...","context_sentence":"..."}]
}`;

  const userPrompt = `Write a Japanese learning article about: ${newsData.topic} (${newsData.region})
TARGET LENGTH: ${config.target_word_count || 200} content words in the body (do NOT count [NEW] or [REVIEW] markers — count only actual words).

IMPORTANT: This article is for a ${config.proficiency_level} level student. Follow the three-tier vocabulary stratification in the system prompt:
- Background = ${isN5User ? 'N5' : `${easierLevels} ONLY (one tier below ${config.proficiency_level})`}
- [NEW] words = EXACTLY ${config.proficiency_level} (all ${config.new_words_per_article} of them)
- [REVIEW] words = from the known-words list below, marked [REVIEW] in the body
If the news topic is complex, simplify it.

News: ${newsContext}
Summary: ${newsData.summary}

${knownWords.length === 0 ? `## 🚫 [REVIEW] MARKERS DISABLED — COLD-START ARTICLE

The user has ZERO previously-learned words. You MUST NOT use any [REVIEW] markers in body_romaji. You MUST leave the reviewWords array EMPTY ([]). Focus entirely on the [NEW] vocabulary. Do NOT mark any words as [REVIEW] no matter how level-appropriate they seem — [REVIEW] only applies to words the user has actually encountered in previous articles, and they haven't read any yet.` : `## Known words for [REVIEW] reuse (${knownWords.length} available, showing the 30 most in need of review — earlier = more urgent):
${knownWords.slice(0, 30).join(', ')}
Prefer words from the START of this list that fit the story. Skip any listed word you know is harder than ${JLPT_ORDER[Math.min(JLPT_ORDER.indexOf(config.proficiency_level) + 1, JLPT_ORDER.length - 1)] || 'N3'} (some stored levels are wrong). Aim for ~5-8 of these to appear in the article wrapped in [REVIEW] markers. If fewer than 5 are listed above, use whatever is available — do not invent [REVIEW] markers for words NOT in this list.`}

Rules: ${wsPrompt.userRules}`;

  // `let` (not `const`) so the judge can replace fields on script-bleeding errors
  let result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 6144,
    temperature: 0.8,
  });

  // Correct Claude's self-assigned JLPT tags against the authoritative
  // reference list (agent/middleware/jlpt-levels.js). Claude systematically
  // UNDER-tags advanced words (labelling 一致/N2, 連立/N1 as "N4"), which fooled
  // the validator + retry loop into passing over-level articles. Correcting the
  // tags here means the level-violation check below sees the TRUE levels and
  // retries to a simpler topic when a story is inherently above the user's level.
  if (Array.isArray(result.newWords)) {
    const { corrected, count } = correctVocabLevels(result.newWords);
    if (count > 0) {
      console.log(`[JLPT] Corrected ${count} mislabeled level(s): ` +
        corrected.map(c => `${c.word} ${c.from}→${c.to}`).join(', '));
    }
  }

  // Post-process: strip markers from summary (should never have them)
  if (result.summary_romaji) {
    result.summary_romaji = stripAllMarkers(result.summary_romaji);
  }

  // Safety net: convert any Japanese chars in title/summary to romaji
  if (writingSystem === 'romaji') {
    if (result.title_romaji && containsJapaneseChars(result.title_romaji)) {
      const fixed = await fixJapaneseCharsInBody(result.title_romaji);
      result.title_romaji = fixed;
    }
    if (result.summary_romaji && containsJapaneseChars(result.summary_romaji)) {
      const fixed = await fixJapaneseCharsInBody(result.summary_romaji);
      result.summary_romaji = fixed;
    }
  }

  // Post-process: strip [NEW] markers from particles and common words in body (romaji mode only)
  if (writingSystem === 'romaji' && result.body_romaji) {
    result.body_romaji = stripMarkersFromCommonWords(result.body_romaji);
    // Safety net: convert any remaining hiragana/katakana/kanji to romaji
    result.body_romaji = await fixJapaneseCharsInBody(result.body_romaji);
  }

  // Post-process: normalize spacing in kanji/kana body so the iOS whitespace tokeniser
  // can correctly isolate [NEW]/[REVIEW] markers to individual words (not whole sentences).
  // Without this, natural Japanese (no spaces) causes e.g. "[NEW]彫刻家（ちょうこくか）ブランクーシの..."
  // to be treated as one token, turning the entire sentence blue instead of just the vocab word.
  if ((writingSystem === 'kanji' || writingSystem === 'kana') && result.body_romaji) {
    result.body_romaji = normalizeKanjiBodySpacing(result.body_romaji);
  }

  // Post-process: conservative text normalization (verb-suffix attachment,
  // suru-verb passive fixes, devoiced copulas, numeric formatting,
  // known-hallucination fixes). Runs before QA validation so any fixes are
  // visible to the checker.
  if (result.body_romaji) {
    result.body_romaji = normalizeBody(result.body_romaji, writingSystem);
  }
  // Also run hallucination + token-level fixes on title and summary — they
  // share the same romaji generation path and are equally vulnerable.
  if (result.title_romaji) {
    result.title_romaji = normalizeBody(result.title_romaji, writingSystem);
  }
  if (result.summary_romaji) {
    result.summary_romaji = normalizeBody(result.summary_romaji, writingSystem);
  }
  // And every vocab entry — the kana field can be right while the romaji
  // field is hallucinated (see KNOWLEDGE_HUB.md "kumaudo" case).
  for (const w of (result.newWords || [])) {
    if (w.word_romaji_macron) w.word_romaji_macron = normalizeWord(w.word_romaji_macron);
    if (w.word_romaji)        w.word_romaji        = normalizeWord(w.word_romaji);
  }
  for (const w of (result.reviewWords || [])) {
    if (w.word_romaji_macron) w.word_romaji_macron = normalizeWord(w.word_romaji_macron);
    if (w.word_romaji)        w.word_romaji        = normalizeWord(w.word_romaji);
  }

  // ---- Layer 2.5: Wanakana auto-fix for Class A romaji hallucinations ----
  // For every vocab entry where word_kana exists and word_romaji_macron
  // disagrees with it, regenerate the romaji deterministically from the kana
  // (with Hepburn macron rules) and find-and-replace bad spellings throughout
  // title / summary / body. See agent/middleware/wanakana-fix.js and
  // KNOWLEDGE_HUB §3.5 "Quality Framework" for the rationale.
  const wanakanaResult = autoFixHallucinatedRomaji(result);
  if (wanakanaResult.fixesMade.length > 0) {
    console.log(`[Wanakana] Auto-fixed ${wanakanaResult.fixesMade.length} romaji hallucination(s):`);
    wanakanaResult.fixesMade.forEach(f =>
      console.log(`  • "${f.from}" → "${f.to}"  (kana=${f.kana}${f.kanji ? `, kanji=${f.kanji}` : ''})`)
    );
    // Surface for telemetry — stored alongside reviewer_fixes
    result._wanakana_fixes = wanakanaResult.fixesMade.map(f => `${f.from} → ${f.to}`);
  }

  // Post-process: remove particles/common words from newWords array
  if (result.newWords) {
    result.newWords = result.newWords.filter(w => !isCommonWord(w.word_romaji_macron));
  }

  // ============================================================
  // ARCHITECTURE STEP: Convert kanji+furigana \u2192 user's target script
  // ============================================================
  // Claude generated in kanji+furigana (most reliable mode). Now deterministically
  // convert title/summary/body to the user's preferred writing system using the
  // furigana as ground truth. This eliminates Class A romaji hallucinations.
  // Vocabulary fields are unchanged (Layer 2.5 already handled those).
  if (userWritingSystem !== 'kanji') {
    console.log(`[Convert] kanji+furigana \u2192 ${userWritingSystem}`);
    if (result.title_romaji)   result.title_romaji   = convertScript(result.title_romaji,   userWritingSystem);
    if (result.summary_romaji) result.summary_romaji = convertScript(result.summary_romaji, userWritingSystem);
    if (result.body_romaji)    result.body_romaji    = convertScript(result.body_romaji,    userWritingSystem);

    // After conversion, run the user-mode normalize pass to clean up any
    // edge-case hallucinations that survived (e.g., loanwords in katakana that
    // wanakana converted to wrong romaji). Same KNOWN_HALLUCINATIONS, te-form
    // rules, sh-digraph, etc. \u2014 they expect text in the user's writing system.
    if (result.body_romaji)    result.body_romaji    = normalizeBody(result.body_romaji,    userWritingSystem);
    if (result.title_romaji)   result.title_romaji   = normalizeBody(result.title_romaji,   userWritingSystem);
    if (result.summary_romaji) result.summary_romaji = normalizeBody(result.summary_romaji, userWritingSystem);

    // Deterministically split over-long sentences at clean clause boundaries
    // (comma / te-form). Replaces the old futile "retry with a new topic when
    // sentences are too long" logic, which tripled pipeline time and caused
    // app timeouts (changing topic never shortened Claude's sentences).
    // Romaji only \u2014 kana/kanji modes have their own spacing conventions.
    if (userWritingSystem === 'romaji' && result.body_romaji) {
      const maxLen = parseInt(config.max_sentence_length) || 15;
      result.body_romaji = splitLongSentences(result.body_romaji, maxLen);
    }
  }

  // From here on, the article is in the user's writing system. Reassign
  // `writingSystem` to the user's preference so downstream post-processing
  // (validation, reviewer, word count) treats the converted content correctly.
  // eslint-disable-next-line no-param-reassign
  const postWritingSystem = userWritingSystem;

  // Attach writing system to result for downstream use
  result._writing_system = postWritingSystem;

  // Override word_count with our own measured count (not Claude's self-report which
  // may include [NEW]/[REVIEW] markers or be otherwise inaccurate).
  if (result.body_romaji) {
    const cleanBody = result.body_romaji.replace(/\[(NEW|REVIEW)\]\s*/g, '').trim();
    if (postWritingSystem === 'romaji') {
      result.word_count = cleanBody.split(/\s+/).filter(Boolean).length;
    } else {
      result.word_count = (cleanBody.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length;
    }
    console.log(`[Word count] Measured: ${result.word_count} (target: ${config.target_word_count || 200})`);
  }

  // Quality validation — runs in <1ms, no API calls
  const qv = validateArticleQuality(result, config);
  if (qv.warnings.length > 0) {
    console.warn(`[QA] ${qv.warnings.length} warning(s):`);
    qv.warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
  }
  if (qv.errors.length > 0) {
    console.error(`[QA] ${qv.errors.length} error(s) — article may have quality issues:`);
    qv.errors.forEach(e => console.error(`  ❌  ${e}`));
    // Log loudly but don't throw — a partial article is better than no article.
    // To make errors fatal, replace the line above with: throw new Error(`Article QA failed: ${qv.errors.join('; ')}`);
  }
  if (qv.valid && qv.warnings.length === 0) {
    console.log('[QA] ✅ All quality checks passed.');
  }

  // ---- Conditional Judge ----
  // Only fires when: (a) writing system is romaji AND (b) QA found script-bleeding errors.
  // This means the normal post-processing (fixJapaneseCharsInBody) already ran and still
  // left Japanese characters behind — a second, targeted rewrite is warranted.
  if (postWritingSystem === 'romaji' && qv.errors.some(e => e.startsWith('Script bleeding'))) {
    result = await runScriptBleedingJudge(result);

    // Quick re-validation to confirm the judge resolved the issue
    const postJudgeQv = validateArticleQuality(result, config);
    const stillBleeding = postJudgeQv.errors.some(e => e.startsWith('Script bleeding'));
    if (stillBleeding) {
      console.error('[Judge] ⚠️  Script bleeding persists after correction pass — saving article as-is.');
    } else {
      console.log('[Judge] ✅ Script bleeding fully resolved.');
    }
  }

  // ---- Quality Reviewer pass (Layer 3 of the quality framework) ----
  // Runs unconditionally on every article. Catches semantic errors that
  // deterministic regex can't: wrong loanword choice (kumo→kuraudo),
  // context-inappropriate vocab (mimikaki→iyahon), counter mismatches,
  // phonetic-slip real words (sekkai→sekai), gibberish phrases, and factual
  // drift from the source. See agent/middleware/quality-reviewer.js and
  // KNOWLEDGE_HUB.md "Quality Framework" section.
  const { article: reviewed, fixesMade } = await runQualityReviewer(result, newsData, config);
  result = reviewed;

  // Final deterministic cleanup AFTER the reviewer. The reviewer edits text by
  // hand and occasionally INTRODUCES errors — e.g. article #148, it joined
  // "e mashita" into "emasita" (dropped the sh). Re-running normalizeBody here
  // catches those (sh-digraph, te-form, hallucination fixes) deterministically.
  // Idempotent, so it doesn't disturb already-correct text.
  if (postWritingSystem === 'romaji') {
    if (result.body_romaji)    result.body_romaji    = normalizeBody(result.body_romaji,    postWritingSystem);
    if (result.title_romaji)   result.title_romaji   = normalizeBody(result.title_romaji,   postWritingSystem);
    if (result.summary_romaji) result.summary_romaji = normalizeBody(result.summary_romaji, postWritingSystem);
  }

  // Title and summary must never carry markers. The early summary strip isn't
  // enough: the judge and reviewer rewrite both fields and can re-add markers
  // (#185 summary), and titles were never stripped at all (#184, #185, #190).
  if (result.title_romaji)   result.title_romaji   = stripAllMarkers(result.title_romaji);
  if (result.summary_romaji) result.summary_romaji = stripAllMarkers(result.summary_romaji);

  if (fixesMade.length > 0) {
    result._reviewer_fixes = fixesMade; // surfaced into article doc for telemetry
    // Re-measure word_count since reviewer may have changed body length.
    if (result.body_romaji) {
      const cleanBody = result.body_romaji.replace(/\[(NEW|REVIEW)\]\s*/g, '').trim();
      if (postWritingSystem === 'romaji') {
        result.word_count = cleanBody.split(/\s+/).filter(Boolean).length;
      } else {
        result.word_count = (cleanBody.match(/[぀-ゟ゠-ヿ一-鿿]/g) || []).length;
      }
    }
  }

  console.log(`[Step 3+4] Article (${postWritingSystem}): "${result.title_romaji}"`);
  console.log(`[Step 3+4] Words: ${result.word_count}, New: ${result.newWords?.length || 0}, Review: ${result.reviewWords?.length || 0}`);
  return result;
}

// =============================================
// STEP 3: Quiz Generation
// =============================================
// Grammar points that clash with English and keep slipping in free production
// at N4/N3. One is picked at random per quiz so they rotate.
const GRAMMAR_FOCUS = [
  {
    name: 'verb pairs',
    instructions: 'transitive/intransitive verb pair. A sentence with one verb as ___; options are both members of a pair in the right form plus one form of another pair (agaru/ageru, sagaru/sageru, fueru/fuyasu, heru/herasu, kimaru/kimeru, kawaru/kaeru, hajimaru/hajimeru). The ___ is the MAIN verb at the end of the sentence, and its own particle decides it: X ga + intransitive, Y wa X wo + transitive. Never gap an adverbial te-form ("ni shū tsuzukete" = in a row) — both forms can be natural there. Prices go up/down = agaru/ageru, sagaru/sageru (not fueru).',
  },
  {
    name: 'reported speech',
    instructions: '"Which sentence is correct?" (stem: "Dore ga tadashii desu ka?") — 4 sentences reporting what someone said. Correct: [speaker] wa, [plain statement] (noun / na-adjective + da) to iimashita / happyō shimashita. Wrong options: speaker in the middle of the quote, missing da after a noun / na-adjective, "wo iimashita" instead of "to".',
  },
  {
    name: 'node',
    instructions: '"Which sentence is correct?" (stem: "Dore ga tadashii desu ka?") — 4 sentences with node (because). Correct: verb / i-adjective / -tai + node; noun / na-adjective + na node. Wrong options: "-tai na node", "takai na node", noun / na-adjective without na ("shizuka node").',
  },
  {
    name: 'naru',
    instructions: 'becoming: a sentence with ___ naru. Noun / na-adjective + ni naru, i-adjective → -ku naru (no particle); the thing that changes takes ga. Options e.g. takaku / takai ni / takai ga / takaku ni.',
  },
];

function pickGrammarFocus(level) {
  if (!['N4', 'N3'].includes(level)) return null;
  return GRAMMAR_FOCUS[Math.floor(Math.random() * GRAMMAR_FOCUS.length)];
}

/** The question types for one quiz, in order. Article questions first, then grammar, then review. */
function planQuizMix(total, reviewCount, hasGrammar) {
  const extras = [...(hasGrammar ? ['grammar'] : []), ...Array(reviewCount).fill('review')];
  const articleSlots = Math.max(total - extras.length, 3);
  const priority = ['comprehension', 'particle', 'context', 'reverse', 'meaning', 'comprehension', 'meaning', 'context', 'reverse'];
  const order = ['meaning', 'reverse', 'context', 'particle', 'comprehension'];
  const article = priority.slice(0, articleSlots).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...article, ...extras].slice(0, Math.max(total, articleSlots));
}

async function generateQuiz(article, config, quizReviewWords = []) {
  const writingSystem = article._writing_system || config.writing_system || 'romaji';
  console.log(`[Step 5] Generating quiz (${writingSystem})...`);

  const newWordsList = (article.newWords || [])
    .map(w => `${w.word_romaji_macron} = ${w.meaning_en}`)
    .join(', ');

  // Older words to recall (not this article's new words)
  const newSet = new Set((article.newWords || []).map(w => w.word_romaji_macron));
  const reviewTargets = quizReviewWords.filter(w => !newSet.has(w.word_romaji_macron));
  const grammarFocus = pickGrammarFocus(config.proficiency_level);
  const questionPlan = planQuizMix(parseInt(config.quiz_questions_count) || 7, reviewTargets.length, !!grammarFocus);

  // Compute the user's tier rules (same logic as article generation).
  // For N3 user → easier = "N5, N4"; for N4 → "N5"; N5 → degenerate.
  const targetLevel = config.proficiency_level;
  const targetIdx = JLPT_ORDER.indexOf(targetLevel);
  const easierLevels = targetIdx > 0
    ? JLPT_ORDER.slice(0, targetIdx).join(', ')
    : 'N5';
  const isN5User = targetIdx <= 0;
  const maxLen = parseInt(config.max_sentence_length) || 13;

  // Writing system instructions for quiz
  let wsQuizRules = '';
  if (writingSystem === 'kana') {
    wsQuizRules = '\n- Write all questions in hiragana/katakana (no romaji, no kanji)\n- Answers should be in hiragana/katakana';
  } else if (writingSystem === 'kanji') {
    wsQuizRules = '\n- Write questions in kanji with furigana: 漢字（かんじ）\n- Answers can be in kana or kanji with furigana';
  } else {
    wsQuizRules = '\n- Write all questions in romaji';
  }

  const systemPrompt = `Generate quiz questions for a Japanese learning article. Respond with ONLY JSON:
{"questions":[{"type":"meaning/reverse/context/particle/comprehension/review/grammar","question_romaji":"...","question_en":"...","correct_answer":"...","distractors":["...","...","..."],"hint":"...","vocabulary_word":"..."}]}

🎯 DIFFICULTY (the user said quizzes were too easy — the right option was guessable without knowing the word):

QUESTION MIX — exactly these ${questionPlan.length} questions, in this order: ${questionPlan.join(', ')}. Each meaning / reverse / context question tests a DIFFERENT [NEW] word.
- **meaning**: Japanese word → English meaning.
- **reverse**: English meaning → pick the Japanese word (all 4 options are Japanese words). Stem e.g. "'To sell' wa nihongo de nan desu ka?"
- **context**: a sentence from the article with the [NEW] word replaced by ___; the options are 4 Japanese words that all fit grammatically, only one fits the meaning.
- **particle**: a short sentence from the article with one particle replaced by ___; options are particles (ga / wo / ni / de / wa / to / kara / made). Test the particle choices that carry meaning (who did it, where, direction), not "no". Exactly ONE option may be grammatical — so never offer both "wa" and "ga" (both usually fit).
- **comprehension**: about what happened in the article (who did what, why, what changed).${reviewTargets.length ? `
- **review**: recall of an OLDER word the learner met in earlier articles (listed in the user message). English meaning → pick the Japanese word; 4 Japanese options from the same field. The word does not need to be in this article. The hint gives a context clue, never "it's a loanword" or the sound. vocabulary_word = the word exactly as listed.` : ''}${grammarFocus ? `
- **grammar**: ${grammarFocus.instructions}
  Use a sentence about this article where possible. The 4 options are IDENTICAL except at the tested spot (no other changes like an added "ka" or a different tense). Exactly ONE option is correct; each wrong option has exactly one clear mistake of this pattern and is otherwise correct. If you can't make an unambiguous question, use a verb-pair gap instead. The hint states the rule in one short line (in English), never the answer. vocabulary_word = null.` : ''}

DISTRACTORS must be tempting — a reader who doesn't know the word must NOT be able to guess:
- SAME semantic field and part of speech as the answer. daitōryō → shushō / giin / chiji (not "school teacher"). uru → kau / kariru / kaesu (not "to sleep"). kimeru → kiku / kaeru / kuraberu.
- SAME language as the correct answer: all 4 options English, or all 4 Japanese. Never mix.
- SIMILAR length and form: if the answer is "To decide", distractors are "To check", "To change"… Never one long, specific answer among short ones. No "A, B" double answers ("Last, final") unless every option has that form.
- Comprehension distractors reuse REAL names, places and details from the article in a wrong combination (the wrong person, the wrong reason, the opposite change). Never absurd options like "Because the bank gives free food".
- No absurd, joke or obviously-off-topic options.
- For reverse / review questions (English → Japanese): no distractor may ALSO be a valid translation of the English prompt ('plan' → keikaku; yotei is also "plan", so not yotei). Make the English prompt specific enough that only one option fits.
- For context questions: read the full sentence with EACH wrong option in the blank. If it would still be a natural, true sentence about the article, replace that option. ❌ "Hito wa Katsushika wo ___ imasu." ✔ sagashite ✘ erande (people choosing Katsushika is also true, so two answers are right). Prefer a verb that clashes with the sentence (a wrong object, a wrong result) over a near-synonym.

question_en must NEVER contain the answer or its translation (for context/particle questions, give a gloss of the other words only, or leave it null). For particle questions, never say what the particle does ("marks the object") — that is the test.
hint: a clue that helps on a second look (which part of the article, a grammar point) — NEVER the answer itself, its translation, or the full article sentence that contains it.

🛑 LEVEL ENFORCEMENT (CRITICAL — same scaffolding as the article):

The user is at **${targetLevel}** level. Your quiz must respect three vocabulary tiers:

1. **QUESTION STEMS** (the question text itself): use ONLY ${isN5User ? 'N5' : easierLevels} vocabulary.
   The question is FOR the user to read — it must be easier than what's being tested.
   ${isN5User ? '' : `Do NOT use ${targetLevel} vocabulary in question stems unless quoting the article.`}

2. **CORRECT ANSWERS**: vocabulary words from the article's [NEW] words list (at ${targetLevel}) OR a translation/definition in ${isN5User ? 'N5' : easierLevels}.

3. **DISTRACTORS** (wrong-answer options): SAME ${isN5User ? 'N5' : `${targetLevel} or ${easierLevels}`} level as the answers — NEVER harder.
   If the correct answer is "${targetLevel}" word X, distractors must be other plausible ${targetLevel}-or-easier Japanese words. NEVER introduce N3/N2/N1 vocabulary as distractors for an N4 user.

🛑 **DO NOT use these words in stems or distractors for N4 users** (they're N3 background-leakage words):
- 政府 (seifu), 建物 (tatemono), 人口 (jinkō), 政策 (seisaku), 環境 (kankyō)
- 経済 (keizai), 開発 (kaihatsu), 暖房 (danbō), 対策 (taisaku), 技術 (gijutsu)
- 規則 (kisoku), 管理 (kanri), 企業 (kigyō), 投資 (tōshi), 可能性 (kanōsei)
If you'd naturally use one, simplify or use a loanword instead.

🛑 **Question sentence length**: max ${maxLen} words per question. Short, clear stems are critical for learning.

OTHER RULES:
- NEVER test acronyms (PMI, GDP, BOJ, etc.) — only real Japanese vocabulary
- NEVER ask about specific numbers, percentages, or dates from the article
- Focus on MEANING of Japanese words, PARTICLES + COMPREHENSION of article content
- All answer options must be COMPLETE, FULL-LENGTH — never truncate${wsQuizRules}`;

  const userPrompt = `${config.quiz_questions_count} questions for an article titled: "${article.title_romaji}"

User level: **${targetLevel}**. Stems use ${easierLevels}. Distractors use ${targetLevel}-or-easier. NO N3 words for N4 users.

Article: ${article.body_romaji}

[NEW] words from this article (these ARE the test targets — use them in correct_answer/vocabulary_word):
${newWordsList || '(none)'}
${reviewTargets.length ? `
Older words for the "review" questions (one question each):
${reviewTargets.map(w => `${w.word_romaji_macron} = ${w.meaning_en}`).join('\n')}
` : ''}
Generate exactly these ${questionPlan.length} questions: ${questionPlan.join(', ')}. 3 tempting, same-field, same-language, same-length distractors each. No acronyms or number recall.`;

  let result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 3072,
  });

  // Quiz reviewer — second pass to catch level violations the generation missed.
  // Mirrors the article-side reviewer pattern. Adds ~10-15s but catches the
  // N3-in-N4-quiz issue. Non-fatal: on parse error, the original quiz is kept.
  result = await runQuizReviewer(result, article, config, easierLevels);

  // Giveaway check — the user found quizzes too easy (right option guessable
  // from language, length or the hint). One fix round; non-fatal.
  result = await fixQuizGiveaways(result, article, config, easierLevels, reviewTargets);

  // Run the deterministic spelling fixes on quiz text too — a distractor once
  // carried the wrong te-form "tsukaite" (quiz #1283), teaching a bad form.
  // Only fixKnownHallucinations-level fixes (via normalizeBody) on romaji.
  if (Array.isArray(result.questions) && (config.writing_system || 'romaji') === 'romaji') {
    for (const q of result.questions) {
      for (const f of ['question_romaji', 'correct_answer', 'hint']) {
        if (typeof q[f] === 'string') q[f] = normalizeBody(q[f], 'romaji');
      }
      if (Array.isArray(q.distractors)) q.distractors = q.distractors.map(d => typeof d === 'string' ? normalizeBody(d, 'romaji') : d);
    }
  }

  console.log(`[Step 5] Generated ${result.questions?.length || 0} questions`);
  return result;
}

/**
 * Send the problems found by quiz-check.js back to Claude once. The fixed quiz
 * is kept only if it has fewer problems and the same number of questions.
 */
async function fixQuizGiveaways(quizResult, article, config, easierLevels, reviewTargets = []) {
  if (!quizResult?.questions?.length) return quizResult;
  const expected = { reviewWords: reviewTargets.map(w => w.word_romaji_macron) };
  const found = findGiveaways(quizResult.questions, expected);
  const before = countProblems(found);
  if (before === 0) {
    console.log('[Quiz Check] No giveaways found.');
    return quizResult;
  }
  console.log(`[Quiz Check] ${before} giveaway(s):\n${describeProblems(found, quizResult.questions)}`);

  const systemPrompt = `You fix Japanese-learning quiz questions that are too easy to guess. Respond with ONLY JSON, same shape as the input: {"questions":[...]}

Rules:
- Distractors: same semantic field and part of speech as the answer, same language as the answer (all English or all Japanese), similar length and form. daitōryō → shushō / giin / chiji. uru → kau / kariru / kaesu.
- Comprehension distractors reuse real names and details from the article in a wrong combination.
- At most 2 "meaning" questions. Other types: "reverse" (English → pick the Japanese word), "context" (article sentence with the word as ___, 4 Japanese words that fit grammatically), "particle" (article sentence with one particle as ___, options are particles, exactly one grammatical, never both "wa" and "ga").
- Hints and question_en never contain the answer or its translation.
- User level ${config.proficiency_level}: stems use ${easierLevels} words, distractors ${config.proficiency_level} or easier. Keep the article's [NEW] words as test targets (vocabulary_word).
- "review" questions test the listed older words (English → Japanese word); "grammar" questions keep their pattern and exactly one correct option. Don't change these two types.
- Change only what the problems list mentions. Keep the same number of questions.`;

  const userPrompt = `Problems found:
${describeProblems(found, quizResult.questions)}

Article: ${article.body_romaji}

Quiz JSON:
${JSON.stringify({ questions: quizResult.questions }, null, 2)}`;

  try {
    const fixed = await callClaudeJSON(systemPrompt, userPrompt, { max_tokens: 3072, temperature: 0 });
    if (!Array.isArray(fixed?.questions) || fixed.questions.length !== quizResult.questions.length) {
      console.warn('[Quiz Check] Fix returned a different shape — keeping original quiz.');
      return quizResult;
    }
    const after = countProblems(findGiveaways(fixed.questions, expected));
    if (after >= before) {
      console.warn(`[Quiz Check] Fix did not help (${before} → ${after}) — keeping original quiz.`);
      return quizResult;
    }
    console.log(`[Quiz Check] Fixed: ${before} → ${after} giveaway(s).`);
    return { questions: fixed.questions };
  } catch (err) {
    console.error('[Quiz Check] Fix failed — keeping original quiz:', err.message);
    return quizResult;
  }
}

/**
 * Quiz-specific reviewer. Same anti-invention pattern as the article reviewer:
 * only fix when confident, leave originals if uncertain.
 */
async function runQuizReviewer(quizResult, article, config, easierLevels) {
  if (!quizResult?.questions?.length) return quizResult;
  const targetLevel = config.proficiency_level;
  const maxLen = parseInt(config.max_sentence_length) || 13;
  console.log('[Quiz Reviewer] Checking quiz for level violations...');

  const systemPrompt = `You are a Japanese-learning quiz reviewer. Your job: scan a quiz and fix any vocabulary that's harder than the user's level.

🛑 STRICT RULES (the same scaffolding as the article):

User level: ${targetLevel}
- QUESTION STEMS must use ONLY ${easierLevels} words (easier tier)
- DISTRACTORS must be ${targetLevel}-or-easier — NEVER N3 for an N4 user, NEVER N2 for an N3 user
- CORRECT ANSWERS may be at ${targetLevel} (those are the test targets)

🛑 SPECIFIC N3 WORDS FORBIDDEN in N4 quizzes (replace with N5 equivalents if found):
| Wrong (N3) | Right (N5) |
|---|---|
| 政府 (seifu) | 国 (kuni) |
| 建物 (tatemono) | 家 (ie) or ビル (biru) |
| 人口 (jinkō) | 人の数 |
| 政策 (seisaku) | ルール |
| 環境 (kankyō) | 自然 or まわり |
| 経済 (keizai) | お金 |
| 開発 (kaihatsu) | 作る |
| 対策 (taisaku) | 方法 (hōhō, N4) |
| 技術 (gijutsu) | leave or simplify |

🛑 Question stems must be ≤ ${maxLen} words. If longer, simplify.

🛑 ANTI-INVENTION: if you can't replace with a real ${easierLevels} word that fits, LEAVE the original. Don't invent words.

🛑 KEEP THE QUIZ HARD: a replacement distractor must stay in the same field, language and length as the correct answer (daitōryō → shushō, not "school teacher"), and must NOT also be a correct answer ('plan' → keikaku; never add yotei, which also means "plan"). In a context question, every wrong option put in the blank must give a wrong or odd sentence (Katsushika wo sagashite ✔ — erande would also be true, so never use it). Don't change question types.

Return the FULL quiz JSON with fixes applied, same shape as input:
{"questions": [{...}, {...}], "fixes_made": ["..."]}

The fixes_made field is a brief list of what you changed.`;

  const userPrompt = `Review this ${targetLevel} quiz. Fix any N3+ words in stems or distractors per the rules.

Current quiz JSON:
${JSON.stringify(quizResult, null, 2)}

Article context (for reference): ${article.title_romaji}
[NEW] target vocab: ${(article.newWords || []).map(w => `${w.word_romaji_macron} (${w.jlpt_level})`).join(', ')}

Return corrected JSON with the same shape + a fixes_made list. If everything is already level-appropriate, return unchanged with fixes_made: [].`;

  try {
    const reviewed = await callClaudeJSON(systemPrompt, userPrompt, {
      max_tokens: 3072,
      temperature: 0,
    });
    if (Array.isArray(reviewed?.questions) && reviewed.questions.length > 0) {
      const fixes = Array.isArray(reviewed.fixes_made) ? reviewed.fixes_made : [];
      if (fixes.length > 0) {
        console.log(`[Quiz Reviewer] Made ${fixes.length} fix(es):`);
        fixes.forEach(f => console.log(`  • ${f}`));
      } else {
        console.log('[Quiz Reviewer] No fixes needed.');
      }
      return { questions: reviewed.questions };
    }
    console.warn('[Quiz Reviewer] Returned malformed JSON — keeping original quiz.');
    return quizResult;
  } catch (err) {
    console.error('[Quiz Reviewer] Pass failed — keeping original quiz:', err.message);
    return quizResult;
  }
}

// =============================================
// PREFETCH: Load all Firestore data in parallel
// =============================================
/**
 * Load config, recent articles, and known vocabulary all at once.
 * Saves ~500ms–1s vs sequential fetching inside each step.
 */
/**
 * Order the user's vocabulary by how much each word needs review, so the
 * article reuses words the learner is about to forget instead of the ones
 * seen most often (kaisha/tōshi appeared in nearly every article while
 * shisan/jidai were forgotten). Uses the quiz data PATCH /vocabulary/:id/test
 * already records. Pure sorting — no extra API calls.
 *
 * Order: due for spaced review → last quiz answer wrong → learning words not
 * seen for longest → other known words → mastered. Words seen in the last
 * 24h go to the back of their group (just met them). Oldest last_seen first.
 * Words more than one level above the target (N2/N1 for an N4 learner) go
 * last — they were met once in an old article and aren't worth drilling.
 */
function selectReviewWords(vocab, targetLevel, now = Date.now()) {
  return sortByReviewNeed(vocab, targetLevel, now)
    .map(w => `${w.word_romaji_macron}${w.word_kanji ? ` (${w.word_kanji})` : ''} = ${w.meaning_en}`);
}

/**
 * Words for the quiz's "review" questions: due, last answer wrong, or still
 * learning (tiers 0–2), not seen in the last 24h, not new in this article.
 * A real delayed-recall test — the [REVIEW] mark alone said nothing about memory.
 */
function selectQuizReviewWords(vocab, targetLevel, count = 2, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  return sortByReviewNeed(vocab, targetLevel, now)
    // lookupLevel: only words the JLPT list knows — rare compounds (chōtatsu, kyū-jōshō) are mis-tagged N4
    .filter(w => w._tier <= 2 && lookupLevel(w) && now - (Date.parse(w.last_seen_at || w.first_seen_at || 0) || 0) >= DAY)
    .slice(0, count)
    .map(w => ({ word_romaji_macron: w.word_romaji_macron, meaning_en: w.meaning_en }));
}

function sortByReviewNeed(vocab, targetLevel, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  const targetIdx = JLPT_ORDER.indexOf(targetLevel);
  // Stored levels are often under-tagged; the reference list wins when it knows the word.
  const tooHard = (w) => targetIdx >= 0 && JLPT_ORDER.indexOf(lookupLevel(w) || w.jlpt_level) > targetIdx + 1;
  const tier = (w) => {
    if (tooHard(w)) return 6;
    if (w.status === 'mastered') return 5;
    if (w.status === 'known' && w.next_review_at && Date.parse(w.next_review_at) <= now) return 0;
    if ((w.times_tested || 0) > 0 && (w.streak_correct || 0) === 0) return 1;
    if (w.status === 'learning') return 2;
    return 3;
  };
  const lastSeen = (w) => Date.parse(w.last_seen_at || w.first_seen_at || 0) || 0;
  const seenToday = (w) => now - lastSeen(w) < DAY;
  return vocab
    .filter(w => ['learning', 'known', 'mastered'].includes(w.status))
    .map(w => ({ ...w, _tier: tier(w) }))
    .sort((a, b) => a._tier - b._tier
      || seenToday(a) - seenToday(b)
      || lastSeen(a) - lastSeen(b));
}

async function prefetchAllData(userId, overrides) {
  const [config, allArticlesSnapshot, allVocabSnapshot] = await Promise.all([
    loadConfig(userId),
    collections.articles.where('user_id', '==', userId).get(),
    collections.vocabulary.where('user_id', '==', userId).get(),
  ]);

  const mergedConfig = { ...config, ...overrides };

  // Pre-sort recent articles (used by news search for dedup + round-robin)
  const recentArticles = allArticlesSnapshot.docs
    .map(doc => doc.data())
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Known vocabulary ordered by review need (used by article generation)
  const allVocab = allVocabSnapshot.docs.map(doc => doc.data());
  const knownWords = selectReviewWords(allVocab, mergedConfig.proficiency_level).slice(0, 100);
  // Older words to test in this article's quiz (delayed recall)
  const quizReviewWords = selectQuizReviewWords(allVocab, mergedConfig.proficiency_level);

  return { config: mergedConfig, recentArticles, knownWords, quizReviewWords };
}

// =============================================
// MAIN PIPELINE
// =============================================
async function runPipeline(overrides = {}, userId) {
  if (!userId) {
    throw new Error('userId is required for pipeline execution');
  }

  const startTime = Date.now();
  console.log('\n========================================');
  console.log('  Article Generation Pipeline Starting');
  console.log(`  User: ${userId.substring(0, 8)}...`);
  console.log('========================================\n');

  // ── Prefetch ALL Firestore data in parallel (config + articles + vocab) ──
  const { config, recentArticles, knownWords, quizReviewWords } = await prefetchAllData(userId, overrides);
  const prefetchTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Config: level=${config.proficiency_level}, topics=${JSON.stringify(config.topics)} (prefetch: ${prefetchTime}s)`);

  try {
    // ── Level-violation retry loop ──────────────────────────────────────────
    // If too many [NEW] words come back ABOVE the user's target level (using
    // the CORRECTED jlpt tags from the reference list), the picked topic is
    // fundamentally too advanced (e.g. coalition politics for an N4 user).
    // Retry with a different category.
    //
    // MAX_ATTEMPTS capped at 2 (one retry): now that JLPT tags are corrected,
    // level violations are common for low-level users on hard domains (finance/
    // politics/tech are inherently N2+). A full 3-retry chain would blow the
    // ~120s budget and time the app out. One retry catches an outlier topic;
    // beyond that we accept + rely on the [NEW]/gloss teaching model rather than
    // spin. THRESHOLD raised to 5 so mild over-level (a couple of teaching
    // words) doesn't trigger a retry — only a genuinely-too-hard topic does.
    const MAX_ATTEMPTS = 2;
    const LEVEL_VIOLATION_THRESHOLD = 5;
    const excludeCategories = [];
    let newsData, articleData;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        console.log(`\n[Pipeline] === Retry attempt ${attempt}/${MAX_ATTEMPTS} ===`);
      }

      // Call 1: Topic + News Search (web search) — uses prefetched recent articles
      newsData = await searchNewsWithTopic(config, userId, recentArticles, excludeCategories);

      if (!newsData.articles || newsData.articles.length === 0) {
        throw new Error('No news articles found');
      }

      // Call 2: Article + Vocabulary (combined) — uses prefetched known words
      articleData = await generateArticleWithVocab(newsData, config, userId, knownWords);

      // Retry check: [NEW] level violations ONLY.
      // We retry with a different topic when the [NEW] words come back above
      // the user's level — because some topics are inherently above-level
      // (e.g. a $75B IPO for an N3 user), and a different topic genuinely helps.
      //
      // We do NOT retry for sentence length: changing the topic never shortens
      // Claude's sentences, so it was futile and tripled pipeline time (caused
      // 176s runs + app timeouts). Sentence length is now fixed deterministically
      // by splitLongSentences() during conversion instead.
      const targetLevel = config.proficiency_level;
      const targetIdx = JLPT_ORDER.indexOf(targetLevel);
      let levelViolations = 0;
      if (targetIdx >= 0 && Array.isArray(articleData.newWords)) {
        for (const w of articleData.newWords) {
          // Only words 2+ levels above count (N2/N1 for an N4 learner). With the
          // full JLPT reference (2026-11-03) many words are now tagged at their
          // true level; counting one-level stretch words (N3 for N4) would make
          // retries — a full extra search + generation — far more common.
          const wordIdx = JLPT_ORDER.indexOf(w.jlpt_level);
          if (wordIdx > targetIdx + 1) levelViolations++;
        }
      }

      const levelOK = levelViolations < LEVEL_VIOLATION_THRESHOLD;

      if (levelOK) {
        if (attempt > 1) {
          console.log(`[Pipeline] ✅ Attempt ${attempt} passed level check (${levelViolations} violations).`);
        }
        break;
      }

      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[Pipeline] ⚠️  ${levelViolations} [NEW] words above ${targetLevel}. ` +
          `Excluding category "${newsData.category}" and retrying.`
        );
        if (newsData.category) excludeCategories.push(newsData.category.toLowerCase());
      } else {
        console.warn(
          `[Pipeline] ⚠️  Final attempt still has ${levelViolations} level violations. ` +
          `Saving anyway — user will get an imperfect article rather than no article.`
        );
      }
    }

    // Call 3: Quiz generation + article ID — both start in parallel
    const [quizResult, articleId] = await Promise.all([
      generateQuiz(articleData, config, quizReviewWords),
      getNextId('articles'),
    ]);

    // Now save everything
    const savedArticle = await saveToDatabase(articleId, articleData, newsData, quizResult, userId, config);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n========================================`);
    console.log(`  Pipeline Complete (${elapsed}s)`);
    console.log(`  Article ID: ${savedArticle.id}`);
    console.log(`  Title: ${savedArticle.title_romaji}`);
    console.log(`========================================\n`);

    return savedArticle;

  } catch (error) {
    console.error('\n[Pipeline Error]', error.message);
    throw error;
  }
}

/**
 * Save pipeline results to Firestore (all documents tagged with user_id).
 */
/**
 * Find the user's existing vocabulary doc for a word. Romaji alone isn't
 * enough: homophones share it (ninki = 任期 "term of office" vs 人気 "popular",
 * article #196 got the wrong one). When both sides have kanji they must match;
 * a doc without kanji still matches on romaji. Returns null if none fits.
 */
async function findExistingVocab(word, userId) {
  const snapshot = await collections.vocabulary
    .where('word_romaji_macron', '==', word.word_romaji_macron)
    .where('user_id', '==', userId)
    .get();
  if (snapshot.empty) return null;
  if (!word.word_kanji) return snapshot.docs[0];
  return snapshot.docs.find(d => d.data().word_kanji === word.word_kanji)
    || snapshot.docs.find(d => !d.data().word_kanji)
    || null;
}

async function saveToDatabase(articleId, articleData, newsData, quiz, userId, config = {}) {
  const batch = firestore.batch();

  // 1. Article
  const articleDocRef = collections.articles.doc(String(articleId));
  batch.set(articleDocRef, {
    id: articleId,
    user_id: userId,
    title_romaji: articleData.title_romaji,
    summary_romaji: articleData.summary_romaji,
    body_romaji: articleData.body_romaji,
    translation_en: articleData.translation_en,
    grammar_points: articleData.grammar_points || [],
    sources: newsData.articles?.map(a => ({ name: a.source, url: a.url })) || [],
    topic: newsData.topic,
    region: newsData.region,
    category: newsData.category || null,
    word_count: articleData.word_count || 0,
    new_word_count: articleData.new_word_count || 0,
    review_word_count: articleData.reviewWords?.length || 0,
    difficulty_score: null,
    writing_system: config.writing_system || 'romaji',
    // Reviewer telemetry — list of fixes applied by the Layer 3 quality
    // reviewer. Useful for debugging "what is the reviewer catching most"
    // and for detecting when the reviewer itself hallucinates a bad fix
    // (see KNOWLEDGE_HUB.md article #100 case). Empty array = clean pass.
    reviewer_fixes: articleData._reviewer_fixes || [],
    // Wanakana telemetry — Class A romaji hallucinations auto-fixed by
    // Layer 2.5 (kana→romaji re-derivation). Useful for tracking which
    // vocab Claude keeps getting wrong.
    wanakana_fixes: articleData._wanakana_fixes || [],
    created_at: new Date().toISOString(),
    read_at: null,
    quiz_completed_at: null,
    quiz_score: null,
  });

  // Vocab IDs used by this article, so quiz questions link to the same
  // homophone the article taught (and to words created in this batch).
  const articleVocabIds = new Map();

  // 2. New vocabulary
  for (const word of (articleData.newWords || [])) {
    // Check if this user already has this word
    const existingDoc = await findExistingVocab(word, userId);

    let vocabId;
    if (existingDoc) {
      const existingData = existingDoc.data();
      vocabId = existingData.id;
      const vocabUpdate = {
        times_seen: (existingData.times_seen || 0) + 1,
        last_seen_at: new Date().toISOString(),
      };
      // Existing vocab docs keep the level they were first saved with — often
      // Claude's under-tag from before the reference list existed (e.g. 効率
      // stored as N4, really N3). Re-level from the reference when it knows
      // the word, so the user's vocab list shows the true level.
      const refLevel = lookupLevel(word);
      if (refLevel && existingData.jlpt_level !== refLevel) {
        vocabUpdate.jlpt_level = refLevel;
      }
      batch.update(existingDoc.ref, vocabUpdate);
    } else {
      vocabId = await getNextId('vocabulary');
      const vocabDocRef = collections.vocabulary.doc(String(vocabId));
      batch.set(vocabDocRef, {
        id: vocabId,
        user_id: userId,
        word_romaji: word.word_romaji || word.word_romaji_macron.replace(/[āīūēō]/g, c => ({ ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' })[c]),
        word_romaji_macron: word.word_romaji_macron,
        word_kanji: word.word_kanji || null,
        word_kana: word.word_kana || null,
        meaning_en: word.meaning_en,
        part_of_speech: word.part_of_speech || null,
        jlpt_level: word.jlpt_level || null,
        category: word.category || 'general',
        status: 'learning',
        times_seen: 1,
        times_tested: 0,
        times_tested_correct: 0,
        times_used_correctly: 0,
        streak_correct: 0,
        first_seen_in_article_id: articleId,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        last_tested_at: null,
        next_review_at: null,
      });
    }

    const avId = await getNextId('articleVocabulary');
    const avDocRef = collections.articleVocabulary.doc(String(avId));
    batch.set(avDocRef, {
      id: avId,
      user_id: userId,
      article_id: articleId,
      vocabulary_id: vocabId,
      is_new: 1,
      is_review: 0,
      context_sentence: word.context_sentence || null,
    });
    articleVocabIds.set(word.word_romaji_macron, vocabId);
  }

  // 3. Review words
  for (const word of (articleData.reviewWords || [])) {
    const existingDoc = await findExistingVocab(word, userId);

    if (existingDoc) {
      const existingData = existingDoc.data();
      articleVocabIds.set(word.word_romaji_macron, existingData.id);

      batch.update(existingDoc.ref, {
        times_seen: (existingData.times_seen || 0) + 1,
        last_seen_at: new Date().toISOString(),
      });

      const avId = await getNextId('articleVocabulary');
      const avDocRef = collections.articleVocabulary.doc(String(avId));
      batch.set(avDocRef, {
        id: avId,
        user_id: userId,
        article_id: articleId,
        vocabulary_id: existingData.id,
        is_new: 0,
        is_review: 1,
        context_sentence: word.context_sentence || null,
      });
    }
  }

  // 4. Quiz questions
  for (const q of (quiz.questions || [])) {
    let vocabId = articleVocabIds.get(q.vocabulary_word) || null;
    if (!vocabId && q.vocabulary_word) {
      const vocabSnapshot = await collections.vocabulary
        .where('word_romaji_macron', '==', q.vocabulary_word)
        .where('user_id', '==', userId)
        .limit(1)
        .get();
      if (!vocabSnapshot.empty) {
        vocabId = vocabSnapshot.docs[0].data().id;
      }
    }

    const questionId = await getNextId('quizQuestions');
    const qDocRef = collections.quizQuestions.doc(String(questionId));
    batch.set(qDocRef, {
      id: questionId,
      user_id: userId,
      article_id: articleId,
      type: q.type,
      question_romaji: q.question_romaji,
      question_en: q.question_en || null,
      correct_answer: q.correct_answer,
      distractors: q.distractors || [],
      hint: q.hint || null,
      vocabulary_id: vocabId,
      answered_correctly: null,
      answered_at: null,
    });
  }

  // 5. Cache news sources
  for (const a of (newsData.articles || [])) {
    const cacheId = await getNextId('newsCache');
    const cacheDocRef = collections.newsCache.doc(String(cacheId));
    batch.set(cacheDocRef, {
      id: cacheId,
      user_id: userId,
      url: a.url || null,
      title: a.headline || null,
      source: a.source || null,
      key_facts: a.keyFacts || [],
      used_in_article_id: articleId,
      cached_at: new Date().toISOString(),
    });
  }

  await batch.commit();
  return await getArticleWithDetails(articleId, userId);
}

/**
 * Get a full article with its vocabulary and quiz questions (per-user).
 */
async function getArticleWithDetails(articleId, userId) {
  const numericId = parseInt(articleId);

  let query = collections.articles.where('id', '==', numericId);
  if (userId) {
    query = query.where('user_id', '==', userId);
  }

  const articleSnapshot = await query.limit(1).get();

  if (articleSnapshot.empty) return null;

  const article = articleSnapshot.docs[0].data();

  const avSnapshot = await collections.articleVocabulary
    .where('article_id', '==', numericId)
    .where('user_id', '==', article.user_id)
    .get();

  const vocabulary = [];
  for (const avDoc of avSnapshot.docs) {
    const av = avDoc.data();
    const vocabSnapshot = await collections.vocabulary
      .where('id', '==', av.vocabulary_id)
      .where('user_id', '==', article.user_id)
      .limit(1)
      .get();

    if (!vocabSnapshot.empty) {
      const vocabData = vocabSnapshot.docs[0].data();
      vocabulary.push({
        ...vocabData,
        is_new: av.is_new,
        is_review: av.is_review,
        context_sentence: av.context_sentence,
      });
    }
  }

  const quizSnapshot = await collections.quizQuestions
    .where('article_id', '==', numericId)
    .where('user_id', '==', article.user_id)
    .get();

  const quizQuestions = quizSnapshot.docs.map(doc => doc.data());

  return {
    ...article,
    vocabulary,
    quiz_questions: quizQuestions,
  };
}

module.exports = {
  runPipeline, loadConfig, getArticleWithDetails,
  // exported for dry-run testing (generate without saving)
  _internals: { prefetchAllData, searchNewsWithTopic, generateArticleWithVocab, generateQuiz, fixQuizGiveaways, stripAllMarkers, findExistingVocab, selectReviewWords, selectQuizReviewWords, sortByReviewNeed, loadConfig, pickGrammarFocus, planQuizMix },
};

// Allow running directly: node agent/pipeline.js
if (require.main === module) {
  runPipeline({}, 'cli-test-user')
    .then(result => {
      console.log('\nGenerated article:', JSON.stringify(result, null, 2).substring(0, 500) + '...');
    })
    .catch(err => {
      console.error('Pipeline failed:', err);
      process.exit(1);
    });
}
