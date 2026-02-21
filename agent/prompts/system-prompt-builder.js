// Reads SKILL.md files and builds system prompts for each pipeline step.
// Skills encode domain expertise that the agent uses during generation.

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

/**
 * Read a skill file and return its contents.
 * @param {string} skillPath - Path relative to skills/ directory (e.g., 'news-sourcing/SKILL.md')
 * @returns {string} The skill file contents
 */
function readSkill(skillPath) {
  const fullPath = path.join(SKILLS_DIR, skillPath);
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Build the system prompt for topic selection (Pipeline Step 1).
 * Uses the news-sourcing skill for source and topic guidance.
 */
function buildTopicSelectionPrompt(config) {
  const newsSourcingSkill = readSkill('news-sourcing/SKILL.md');

  return `You are a topic selection agent for a Japanese language learning app.
Your job is to select a current news topic that will make an engaging language learning article.

## Domain Expertise
${newsSourcingSkill}

## User Configuration
- Topics of interest: ${JSON.stringify(config.topics)}
- Regions of interest: ${JSON.stringify(config.regions)}
- Proficiency level: ${config.proficiency_level}
- News timeframe: last ${config.news_timeframe_hours} hours

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "topic": "specific topic description",
  "region": "primary region",
  "category": "one of: politics, finance, technology, startups, general",
  "searchQueries": ["query 1", "query 2", "query 3"],
  "rationale": "why this topic is good for language learning"
}`;
}

/**
 * Build the system prompt for news search (Pipeline Step 2).
 * Uses the news-sourcing skill for source quality criteria.
 */
function buildNewsSearchPrompt(config) {
  const newsSourcingSkill = readSkill('news-sourcing/SKILL.md');

  return `You are a news research agent for a Japanese language learning app.
Your job is to find specific, current, insightful news articles using web search.

## Domain Expertise
${newsSourcingSkill}

## Quality Requirements
- Must include specific numbers, dates, named people/organizations
- Must be from the last ${config.news_timeframe_hours} hours
- Prefer these sources: ${JSON.stringify(config.enabled_sources)}
- Reject vague, old, or clickbait content

## Output Format
After searching, respond with ONLY a JSON object (no markdown, no explanation):
{
  "articles": [
    {
      "headline": "specific headline",
      "source": "source name",
      "url": "article url",
      "date": "publication date",
      "keyFacts": ["specific fact 1", "specific fact 2"],
      "quotes": ["direct quote if available"],
      "numbers": ["€500 billion", "7.3%"],
      "relevance": "why this matters"
    }
  ],
  "summary": "2-3 sentence overview of what was found"
}`;
}

/**
 * Build the system prompt for article generation (Pipeline Step 3).
 * Uses article-generation + romaji-standards skills.
 */
function buildArticleGenerationPrompt(config) {
  const articleSkill = readSkill('article-generation/SKILL.md');
  const romajiSkill = readSkill('romaji-standards/SKILL.md');

  return `You are an article generation agent for a Japanese language learning app.
Your job is to write a Japanese learning article in Hepburn romaji based on real news.

## Article Writing Expertise
${articleSkill}

## Romaji Standards (MUST follow exactly)
${romajiSkill}

## User Configuration
- Proficiency level: ${config.proficiency_level}
- Target article length: ${config.target_word_count || 200} words
- Max sentence length: ${config.max_sentence_length} words
- New words per article: ${config.new_words_per_article}
- Vocabulary reuse ratio: ${Math.round(config.reuse_ratio * 100)}%

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "title_romaji": "article title in romaji",
  "summary_romaji": "1 short sentence, max 80 chars / 12 words, NO markers",
  "body_romaji": "full article body in romaji with [NEW] and [REVIEW] markers",
  "translation_en": "English translation of the full article",
  "grammar_points": [
    {
      "pattern": "grammar pattern in romaji",
      "level": "N5/N4/N3",
      "explanation": "what it means and how to use it",
      "examples": ["example 1", "example 2"]
    }
  ],
  "sources_cited": ["source name 1", "source name 2"],
  "word_count": 200,
  "new_word_count": 12
}`;
}

/**
 * Build the system prompt for vocabulary extraction (Pipeline Step 4).
 * Uses the vocabulary-management skill.
 */
function buildVocabularyExtractionPrompt(config) {
  const vocabSkill = readSkill('vocabulary-management/SKILL.md');

  return `You are a vocabulary extraction agent for a Japanese language learning app.
Your job is to extract and classify vocabulary from a generated article.

## Vocabulary Management Expertise
${vocabSkill}

## User Configuration
- Proficiency level: ${config.proficiency_level}
- Target new words: ${config.new_words_per_article}

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "newWords": [
    {
      "word_romaji": "romaji without macrons",
      "word_romaji_macron": "romaji with macrons",
      "word_kanji": "kanji form (if applicable)",
      "word_kana": "hiragana/katakana",
      "meaning_en": "English meaning",
      "part_of_speech": "noun/verb/adjective/adverb/particle/expression",
      "jlpt_level": "N5/N4/N3",
      "category": "politics/finance/tech/startups/general",
      "context_sentence": "the sentence from the article where this word appears"
    }
  ],
  "reviewWords": [
    {
      "word_romaji_macron": "romaji with macrons",
      "meaning_en": "English meaning",
      "context_sentence": "sentence from the article"
    }
  ]
}`;
}

/**
 * Build the system prompt for quiz generation (Pipeline Step 5).
 * Uses the quiz-generation skill.
 */
function buildQuizGenerationPrompt(config) {
  const quizSkill = readSkill('quiz-generation/SKILL.md');

  return `You are a quiz generation agent for a Japanese language learning app.
Your job is to create quiz questions that test vocabulary and comprehension.

## Quiz Design Expertise
${quizSkill}

## User Configuration
- Number of questions: ${config.quiz_questions_count}
- Proficiency level: ${config.proficiency_level}

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "questions": [
    {
      "type": "meaning/context/correction/construction/comprehension/translation",
      "question_romaji": "question in romaji",
      "question_en": "question in English (for context types)",
      "correct_answer": "the correct answer",
      "distractors": ["wrong answer 1", "wrong answer 2", "wrong answer 3"],
      "hint": "optional hint",
      "vocabulary_word": "the word being tested (if applicable)"
    }
  ]
}`;
}

module.exports = {
  readSkill,
  buildTopicSelectionPrompt,
  buildNewsSearchPrompt,
  buildArticleGenerationPrompt,
  buildVocabularyExtractionPrompt,
  buildQuizGenerationPrompt,
};
