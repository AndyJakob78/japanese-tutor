// Database service — Firestore (Google Cloud NoSQL)
// Replaces the old SQLite db.js with Firestore operations.
// All functions are async since Firestore uses network calls.

const { Firestore } = require('@google-cloud/firestore');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Initialize Firestore
// - In Cloud Run: uses default credentials automatically
// - Locally: uses GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account key
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID || 'japanese-tutor-487503',
});

// Collection references
const collections = {
  articles: firestore.collection('articles'),
  vocabulary: firestore.collection('vocabulary'),
  articleVocabulary: firestore.collection('article_vocabulary'),
  quizQuestions: firestore.collection('quiz_questions'),
  config: firestore.collection('config'),
  newsCache: firestore.collection('news_cache'),
  counters: firestore.collection('counters'), // For auto-incrementing IDs
};

// --- Auto-increment ID helper ---
// Firestore doesn't have auto-increment, so we track counters manually.

async function getNextId(collectionName) {
  const counterRef = collections.counters.doc(collectionName);
  const result = await firestore.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const next = (doc.exists ? doc.data().next : 1);
    t.set(counterRef, { next: next + 1 });
    return next;
  });
  return result;
}

// --- Default config values (same as old schema.sql) ---

const DEFAULT_CONFIG = {
  proficiency_level: 'N3',
  topics: '["politics","finance","technology","startups"]',
  regions: '["germany","japan","us"]',
  enabled_sources: '[]',
  excluded_sources: '[]',
  new_words_per_article: '12',
  reuse_ratio: '0.65',
  max_sentence_length: '15',
  target_word_count: '200',
  quiz_questions_count: '7',
  review_interval_hours: '24',
  daily_article_goal: '1',
  vocabulary_goal_weekly: '30',
  preferred_categories: '["politics","economy","technology","society"]',
  writing_system: 'romaji',
};

// Initialize default config for a specific user if they don't have config yet.
// Called on first request from a new user (via middleware in index.js).
async function initializeConfigForUser(userId) {
  // Check if this user already has config by looking for one key
  const existing = await collections.config
    .where('user_id', '==', userId)
    .limit(1)
    .get();

  if (!existing.empty) return; // User already has config

  console.log(`[Config] Initializing default config for user ${userId.substring(0, 8)}...`);

  const batch = firestore.batch();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    const docRef = collections.config.doc(); // auto-generated ID
    batch.set(docRef, {
      key,
      value,
      user_id: userId,
      updated_at: new Date().toISOString(),
    });
  }
  await batch.commit();
}

module.exports = { firestore, collections, getNextId, initializeConfigForUser };
