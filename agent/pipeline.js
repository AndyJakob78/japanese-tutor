// Agent Pipeline Orchestrator — Optimized for Speed
// Generates a complete article with vocabulary and quiz in 3 API calls:
//   1. News Search (with topic selection built in) — web_search call
//   2. Article + Vocabulary Generation — single combined call
//   3. Quiz Generation — runs while DB save starts
//
// Target: ~20-30 seconds total

const { callClaudeJSON, callClaudeSearchJSON } = require('../server/services/claude');
const { firestore, collections, getNextId } = require('../server/services/firestore');

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

// =============================================
// STEP 1: Topic Selection + News Search (combined)
// =============================================
async function searchNewsWithTopic(config, userId) {
  console.log('[Step 1+2] Searching for news...');

  // Get this user's recent articles to avoid repeats and determine what category/region to pick next
  const allArticlesSnapshot = await collections.articles
    .where('user_id', '==', userId)
    .get();

  const recentArticles = allArticlesSnapshot.docs
    .map(doc => doc.data())
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const recentTopics = recentArticles
    .slice(0, 10)
    .map(d => `- "${d.topic}" (${d.region}, category: ${d.category || 'unknown'})`);

  // Determine which category and region to suggest next (round-robin)
  const topics = config.topics || ['politics', 'technology', 'society'];
  const regions = config.regions || ['japan', 'germany', 'us'];
  const recentCategories = recentArticles.slice(0, 3).map(d => (d.category || '').toLowerCase());
  const recentRegions = recentArticles.slice(0, 3).map(d => (d.region || '').toLowerCase());

  // Pick a topic category that hasn't been used recently
  const suggestedTopic = topics.find(t => !recentCategories.includes(t)) || topics[Math.floor(Math.random() * topics.length)];
  // Pick a region that hasn't been used recently
  const suggestedRegion = regions.find(r => !recentRegions.includes(r)) || regions[Math.floor(Math.random() * regions.length)];

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
- You MUST pick category "${suggestedTopic}" and region "${suggestedRegion}" for this article
- If no good story exists for that exact combo, pick a different category from the list — but NEVER default to finance/economy unless it's in the user's topics AND hasn't been used in the last 3 articles
- THESE ARE THE USER'S LAST 10 ARTICLES (avoid similar topics!):
${recentTopics.join('\n') || '  (none yet — this is their first article)'}

## Output
Respond with ONLY JSON (no markdown):
{
  "topic": "specific story description (not a vague category)",
  "region": "region",
  "category": "the category from the user's topics list",
  "articles": [{"headline":"...","source":"...","url":"...","date":"...","keyFacts":["..."],"numbers":["..."],"quotes":["..."]}],
  "summary": "2-3 sentence overview"
}`;

  const userPrompt = `Today: ${new Date().toISOString().split('T')[0]}.
Find a current ${suggestedTopic} news story from ${suggestedRegion} for a ${config.proficiency_level}-level Japanese learning article.
Remember: pick something SPECIFIC and INTERESTING — a real event, person, or thing. Not a generic economic trend.
The article will be written at ${config.proficiency_level} level, so the topic should be understandable at that level.`;

  const result = await callClaudeSearchJSON(systemPrompt, userPrompt, {
    max_searches: 3,
    max_tokens: 4096,
  });

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
      systemIntro: 'You write Japanese learning articles in hiragana and katakana (no kanji, no romaji) and extract vocabulary.',
      userRules: `Hiragana + katakana only, NO romaji, NO kanji. Add spaces between words. Max ${config.max_sentence_length} words per sentence. Exactly ${config.new_words_per_article} [NEW] words. Level: ${config.proficiency_level}. Include 1-2 grammar points. Also extract full vocabulary metadata for each [NEW] and [REVIEW] word.`,
    };
  } else if (writingSystem === 'kanji') {
    const kanjiSkill = readSkill('kanji-standards/SKILL.md');
    return {
      skillText: kanjiSkill,
      skillHeader: 'Kanji + Furigana Rules',
      systemIntro: 'You write Japanese learning articles using kanji with furigana and extract vocabulary. Every kanji gets furigana in full-width parentheses: 経済（けいざい）.',
      userRules: `Kanji + furigana in full-width parentheses. Use kanji at or below ${config.proficiency_level} level. Add spaces between phrases. Max ${config.max_sentence_length} words per sentence. Exactly ${config.new_words_per_article} [NEW] words. Level: ${config.proficiency_level}. Include 1-2 grammar points. Also extract full vocabulary metadata for each [NEW] and [REVIEW] word.`,
    };
  } else {
    // Default: romaji
    const romajiSkill = readSkill('romaji-standards/SKILL.md');
    return {
      skillText: romajiSkill,
      skillHeader: 'Romaji Rules',
      systemIntro: 'You write Japanese learning articles in Hepburn romaji and extract vocabulary.',
      userRules: `Hepburn romaji only, NO hiragana/katakana/kanji in article. Max ${config.max_sentence_length} words per sentence. Exactly ${config.new_words_per_article} [NEW] words. Level: ${config.proficiency_level}. Include 1-2 grammar points. Also extract full vocabulary metadata for each [NEW] and [REVIEW] word.`,
    };
  }
}

async function generateArticleWithVocab(newsData, config, userId) {
  const writingSystem = config.writing_system || 'romaji';
  console.log(`[Step 3+4] Generating article + vocabulary (${writingSystem})...`);

  // Get this user's known vocabulary for reuse
  // Fetch all and filter/sort in code to avoid needing composite Firestore indexes
  const allVocabSnapshot = await collections.vocabulary
    .where('user_id', '==', userId)
    .get();

  const knownWords = allVocabSnapshot.docs
    .map(doc => doc.data())
    .filter(d => ['learning', 'known', 'mastered'].includes(d.status))
    .sort((a, b) => (b.times_seen || 0) - (a.times_seen || 0))
    .slice(0, 100)
    .map(d => `${d.word_romaji_macron} = ${d.meaning_en}`);

  const wsPrompt = getWritingSystemPrompt(writingSystem, config);
  const articleSkill = readSkill('article-generation/SKILL.md');

  const newsContext = (newsData.articles || []).map(a =>
    `${a.source}: ${a.headline}. Facts: ${(a.keyFacts || []).join('; ')}. Numbers: ${(a.numbers || []).join(', ')}`
  ).join('\n');

  const systemPrompt = `${wsPrompt.systemIntro}

## Article Writing Expertise
${articleSkill}

## ${wsPrompt.skillHeader}
${wsPrompt.skillText}

## CRITICAL: JLPT ${config.proficiency_level} Level Enforcement
This article MUST be written at ${config.proficiency_level} level. This means:
- ALL vocabulary must be at ${config.proficiency_level} or below (N5 is easiest, N1 is hardest)
- ALL grammar must be at ${config.proficiency_level} or below
- Sentences must be max ${config.max_sentence_length} words
- If the news topic uses advanced vocabulary, SIMPLIFY IT to ${config.proficiency_level} level
- EVERY [NEW] word MUST have jlpt_level at ${config.proficiency_level} or easier (e.g., if level is N3, only N3/N4/N5 words)
- NEVER introduce N2 or N1 words to an N3/N4/N5 student

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

ONLY mark with [NEW]: Meaningful Japanese vocabulary words appropriate for ${config.proficiency_level} level that teach the student something new (nouns, verbs, adjectives, useful adverbs, compound words).

Similarly, do NOT put particles, proper nouns, or basic grammar words in the newWords or reviewWords arrays.

The summary_romaji field must NOT contain [NEW] or [REVIEW] markers — it is plain text. It must be max 80 characters / 12 words (it needs to fit on a small phone screen without truncation).

IMPORTANT: The vocabulary metadata (newWords, reviewWords) must ALWAYS include word_romaji_macron, word_kana, and word_kanji fields regardless of writing system. These are needed for the vocabulary bank.

Respond with ONLY JSON:
{
  "title_romaji": "title",
  "summary_romaji": "1 short sentence, max 80 chars / 12 words, NO markers",
  "body_romaji": "article with [NEW] and [REVIEW] markers",
  "translation_en": "English translation",
  "grammar_points": [{"pattern":"...","level":"N3","explanation":"...","examples":["..."]}],
  "sources_cited": ["source 1"],
  "word_count": 200,
  "new_word_count": 12,
  "newWords": [{"word_romaji":"...","word_romaji_macron":"...","word_kanji":"...","word_kana":"...","meaning_en":"...","part_of_speech":"noun/verb/adj","jlpt_level":"N3","category":"general","context_sentence":"..."}],
  "reviewWords": [{"word_romaji_macron":"...","word_kana":"...","word_kanji":"...","meaning_en":"...","context_sentence":"..."}]
}`;

  const userPrompt = `Write a ${config.target_word_count || 200}-word Japanese learning article about: ${newsData.topic} (${newsData.region})

IMPORTANT: This article is for a ${config.proficiency_level} level student. Use ONLY ${config.proficiency_level}-level vocabulary and grammar or easier. If the news topic is complex, explain it simply.

News: ${newsContext}
Summary: ${newsData.summary}

Known words (reuse naturally): ${knownWords.slice(0, 30).join(', ') || 'none yet'}

Rules: ${wsPrompt.userRules}`;

  const result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 6144,
    temperature: 0.8,
  });

  // Post-process: strip markers from summary (should never have them)
  if (result.summary_romaji) {
    result.summary_romaji = result.summary_romaji
      .replace(/\[NEW\]/g, '')
      .replace(/\[REVIEW\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Post-process: strip [NEW] markers from particles and common words in body (romaji mode only)
  if (writingSystem === 'romaji' && result.body_romaji) {
    result.body_romaji = stripMarkersFromCommonWords(result.body_romaji);
  }

  // Post-process: remove particles/common words from newWords array
  if (result.newWords) {
    result.newWords = result.newWords.filter(w => !isCommonWord(w.word_romaji_macron));
  }

  // Attach writing system to result for downstream use
  result._writing_system = writingSystem;

  console.log(`[Step 3+4] Article (${writingSystem}): "${result.title_romaji}"`);
  console.log(`[Step 3+4] Words: ${result.word_count}, New: ${result.newWords?.length || 0}, Review: ${result.reviewWords?.length || 0}`);
  return result;
}

// =============================================
// STEP 3: Quiz Generation
// =============================================
async function generateQuiz(article, config) {
  const writingSystem = article._writing_system || config.writing_system || 'romaji';
  console.log(`[Step 5] Generating quiz (${writingSystem})...`);

  const newWordsList = (article.newWords || [])
    .map(w => `${w.word_romaji_macron} = ${w.meaning_en}`)
    .join(', ');

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
{"questions":[{"type":"meaning/context/comprehension","question_romaji":"...","question_en":"...","correct_answer":"...","distractors":["...","...","..."],"hint":"...","vocabulary_word":"..."}]}

IMPORTANT RULES:
- NEVER test acronyms (PMI, GDP, BOJ, etc.) — only test real Japanese vocabulary
- NEVER ask about specific numbers, percentages, or dates from the article
- Focus on testing MEANING of Japanese words and COMPREHENSION of the article content
- All answer options (correct + distractors) must be COMPLETE, FULL-LENGTH answers — never truncate
- Distractors must be plausible Japanese words or phrases at the same level${wsQuizRules}`;

  const userPrompt = `${config.quiz_questions_count} questions for: "${article.title_romaji}"
Article: ${article.body_romaji}
New words: ${newWordsList}
Level: ${config.proficiency_level}. Test only real Japanese vocabulary meanings and article comprehension. 3 full-length distractors each. No acronyms or number recall.`;

  const result = await callClaudeJSON(systemPrompt, userPrompt, {
    max_tokens: 3072,
  });

  console.log(`[Step 5] Generated ${result.questions?.length || 0} questions`);
  return result;
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

  const config = { ...(await loadConfig(userId)), ...overrides };
  console.log(`Config: level=${config.proficiency_level}, topics=${JSON.stringify(config.topics)}`);

  try {
    // Call 1: Topic + News Search (web search)
    const newsData = await searchNewsWithTopic(config, userId);

    if (!newsData.articles || newsData.articles.length === 0) {
      throw new Error('No news articles found');
    }

    // Call 2: Article + Vocabulary (combined)
    const articleData = await generateArticleWithVocab(newsData, config, userId);

    // Call 3: Quiz (runs while we start saving)
    const quizPromise = generateQuiz(articleData, config);

    // Start DB save in parallel with quiz generation
    const articleId = await getNextId('articles');
    const quiz = await quizPromise;

    // Now save everything
    const savedArticle = await saveToDatabase(articleId, articleData, newsData, quiz, userId, config);

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
    created_at: new Date().toISOString(),
    read_at: null,
    quiz_completed_at: null,
    quiz_score: null,
  });

  // 2. New vocabulary
  for (const word of (articleData.newWords || [])) {
    // Check if this user already has this word
    const existingSnapshot = await collections.vocabulary
      .where('word_romaji_macron', '==', word.word_romaji_macron)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    let vocabId;
    if (!existingSnapshot.empty) {
      const existingDoc = existingSnapshot.docs[0];
      const existingData = existingDoc.data();
      vocabId = existingData.id;
      batch.update(existingDoc.ref, {
        times_seen: (existingData.times_seen || 0) + 1,
        last_seen_at: new Date().toISOString(),
      });
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
  }

  // 3. Review words
  for (const word of (articleData.reviewWords || [])) {
    const existingSnapshot = await collections.vocabulary
      .where('word_romaji_macron', '==', word.word_romaji_macron)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      const existingDoc = existingSnapshot.docs[0];
      const existingData = existingDoc.data();

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
    let vocabId = null;
    if (q.vocabulary_word) {
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

module.exports = { runPipeline, loadConfig, getArticleWithDetails };

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
