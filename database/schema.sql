-- Vocabulary words tracked across all articles
CREATE TABLE IF NOT EXISTS vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_romaji TEXT NOT NULL,
  word_romaji_macron TEXT NOT NULL,
  word_kanji TEXT,
  word_kana TEXT,
  meaning_en TEXT NOT NULL,
  part_of_speech TEXT,              -- noun, verb, adjective, adverb, particle, expression
  jlpt_level TEXT,                  -- N5, N4, N3, N2, N1
  category TEXT,                    -- politics, finance, tech, startups, general
  status TEXT DEFAULT 'new',        -- new, learning, known, mastered
  times_seen INTEGER DEFAULT 0,
  times_used_correctly INTEGER DEFAULT 0,
  times_tested INTEGER DEFAULT 0,
  times_tested_correct INTEGER DEFAULT 0,
  streak_correct INTEGER DEFAULT 0,
  first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME,
  last_tested_at DATETIME,
  next_review_at DATETIME,
  first_seen_in_article_id INTEGER REFERENCES articles(id)
);

-- Generated articles
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_romaji TEXT NOT NULL,
  summary_romaji TEXT,
  body_romaji TEXT NOT NULL,
  translation_en TEXT,
  grammar_points TEXT,              -- JSON array
  sources TEXT,                     -- JSON array of {name, url}
  topic TEXT,
  region TEXT,
  word_count INTEGER,
  new_word_count INTEGER,
  review_word_count INTEGER,
  difficulty_score REAL,            -- computed from vocabulary + grammar complexity
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME,                 -- when user first opened it
  quiz_completed_at DATETIME,
  quiz_score REAL
);

-- Links vocabulary to articles (many-to-many)
CREATE TABLE IF NOT EXISTS article_vocabulary (
  article_id INTEGER REFERENCES articles(id),
  vocabulary_id INTEGER REFERENCES vocabulary(id),
  is_new BOOLEAN DEFAULT FALSE,
  is_review BOOLEAN DEFAULT FALSE,
  context_sentence TEXT,            -- the sentence in the article where this word appears
  PRIMARY KEY (article_id, vocabulary_id)
);

-- Quiz questions for each article
CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id),
  type TEXT NOT NULL,               -- meaning, context, correction, construction, comprehension, translation
  question_romaji TEXT NOT NULL,
  question_en TEXT,
  correct_answer TEXT NOT NULL,
  distractors TEXT,                 -- JSON array for multiple choice
  hint TEXT,
  vocabulary_id INTEGER REFERENCES vocabulary(id),
  answered_correctly BOOLEAN,
  answered_at DATETIME
);

-- User configuration (key-value store)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cache of fetched news to avoid re-fetching
CREATE TABLE IF NOT EXISTS news_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE,
  title TEXT,
  source TEXT,
  key_facts TEXT,                   -- JSON
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_in_article_id INTEGER REFERENCES articles(id)
);

-- Default config values
INSERT OR IGNORE INTO config (key, value) VALUES
  ('proficiency_level', 'N3'),
  ('max_sentence_length', '18'),
  ('new_words_per_article', '12'),
  ('reuse_ratio', '0.65'),
  ('topics', '["politics","finance","technology","startups"]'),
  ('regions', '["germany","japan","us"]'),
  ('news_timeframe_hours', '48'),
  ('enabled_sources', '["handelsblatt.com","spiegel.de","faz.net","focus.de","reuters.com","bloomberg.com","nikkei.com","japantimes.co.jp"]'),
  ('excluded_sources', '[]'),
  ('include_podcasts', 'true'),
  ('quiz_questions_count', '7'),
  ('auto_generate', 'false'),
  ('auto_generate_interval_hours', '24');
