// Vocabulary routes
// GET  /api/vocabulary — all words (filterable)
// GET  /api/vocabulary/due — words due for spaced repetition review
// GET  /api/vocabulary/review — words for the daily typed review
// POST /api/vocabulary — add a word the learner tapped in an article
// PATCH /api/vocabulary/:id — update word status
// POST /api/vocabulary/:id/test — record a test result

const express = require('express');
const router = express.Router();
const { collections, getNextId } = require('../services/firestore');

// GET /api/vocabulary — list all words (filterable by status, level, category)
router.get('/', async (req, res, next) => {
  try {
    // Fetch all user's vocabulary and filter/sort/paginate in code
    // (avoids needing many composite Firestore indexes for user_id + status/level + sort)
    const snapshot = await collections.vocabulary
      .where('user_id', '==', req.userId)
      .get();

    let words = snapshot.docs.map(doc => doc.data());

    // Apply filters in code
    if (req.query.status) {
      words = words.filter(w => w.status === req.query.status);
    }
    if (req.query.jlpt_level) {
      words = words.filter(w => w.jlpt_level === req.query.jlpt_level);
    }
    if (req.query.category) {
      words = words.filter(w => w.category === req.query.category);
    }
    if (req.query.search) {
      const searchLower = req.query.search.toLowerCase();
      words = words.filter(w =>
        (w.word_romaji_macron && w.word_romaji_macron.toLowerCase().includes(searchLower)) ||
        (w.meaning_en && w.meaning_en.toLowerCase().includes(searchLower))
      );
    }

    // Sorting in code
    const sortMap = {
      'recent': { field: 'last_seen_at', dir: 'desc' },
      'oldest': { field: 'first_seen_at', dir: 'asc' },
      'review_due': { field: 'next_review_at', dir: 'asc' },
      'least_tested': { field: 'times_tested', dir: 'asc' },
      'alphabetical': { field: 'word_romaji_macron', dir: 'asc' },
    };
    const sort = sortMap[req.query.sort] || { field: 'first_seen_at', dir: 'desc' };
    words.sort((a, b) => {
      const aVal = a[sort.field] ?? '';
      const bVal = b[sort.field] ?? '';
      if (sort.dir === 'desc') return String(bVal).localeCompare(String(aVal));
      return String(aVal).localeCompare(String(bVal));
    });

    const total = words.length;

    // Pagination in code
    // Default to 200 so the iOS app shows the full vocabulary list without pagination.
    // iOS can pass ?limit=N&offset=N explicitly for paginated requests (Phase 2).
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = parseInt(req.query.offset) || 0;
    words = words.slice(offset, offset + limit);

    res.json({ vocabulary: words, total });
  } catch (err) {
    next(err);
  }
});

// GET /api/vocabulary/due — words due for spaced repetition review
router.get('/due', async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const limitCount = parseInt(req.query.limit) || 20;

    // Firestore compound query limits: user_id + status IN + next_review_at <= now
    // may require composite index. Fetch user's learning/known words and filter in code.
    const snapshot = await collections.vocabulary
      .where('user_id', '==', req.userId)
      .where('status', 'in', ['learning', 'known'])
      .get();

    const allWords = snapshot.docs.map(doc => doc.data());
    const dueWords = allWords
      .filter(w => w.next_review_at && w.next_review_at <= now)
      .sort((a, b) => (a.next_review_at || '').localeCompare(b.next_review_at || ''))
      .slice(0, limitCount);

    res.json({ due: dueWords, count: dueWords.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/vocabulary/review?limit=10 — words for the daily typed review
// (2026-11-10). /due only returns words with next_review_at set, which most
// words never get, so this ranks by the same review need as the quiz's review
// questions: due, missed last time, still learning — skipping words far above
// the learner's level, words the JLPT list doesn't know, and words tested
// in the last 12 hours.
router.get('/review', async (req, res, next) => {
  try {
    const { _internals: { sortByReviewNeed, loadConfig } } = require('../../agent/pipeline');
    const { lookupLevel } = require('../../agent/middleware/jlpt-levels');
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    const [config, snapshot] = await Promise.all([
      loadConfig(req.userId),
      collections.vocabulary.where('user_id', '==', req.userId).get(),
    ]);
    const now = Date.now();
    const HALF_DAY = 12 * 60 * 60 * 1000;
    const testedRecently = w => w.last_tested_at && now - Date.parse(w.last_tested_at) < HALF_DAY;
    const allWords = snapshot.docs.map(doc => doc.data());
    const words = sortByReviewNeed(allWords, config.proficiency_level, now)
      // lookupLevel: rare compounds (chōtatsu, hyōkagaku) are often mis-tagged N4; only words the JLPT list knows
      .filter(w => w._tier <= 3 && lookupLevel(w) && !testedRecently(w))
      .slice(0, limit)
      .map(({ _tier, ...w }) => w);

    // The prompt is the English meaning, so another word of the learner's with the
    // same meaning is also a right answer ("plan" → keikaku, but yotei is "plan" too).
    const senses = w => String(w.meaning_en || '').toLowerCase()
      .replace(/\([^)]*\)/g, '')
      .split(/[,;/]/)
      .map(s => s.trim().replace(/^to /, ''))
      .filter(Boolean);
    const alsoAccept = {};
    for (const w of words) {
      const mine = new Set(senses(w));
      const others = allWords
        .filter(o => o.id !== w.id && o.word_romaji_macron !== w.word_romaji_macron && senses(o).some(s => mine.has(s)))
        .map(o => o.word_romaji_macron);
      if (others.length) alsoAccept[w.id] = [...new Set(others)];
    }
    res.json({ words, count: words.length, also_accept: alsoAccept });
  } catch (err) {
    next(err);
  }
});

// POST /api/vocabulary — add a tapped word to the learner's vocabulary (2026-11-10)
// Body: { word_romaji_macron, meaning_en, word_kanji?, word_kana?, part_of_speech?,
//         article_id?, context_sentence? }. Returns the existing word if already saved.
router.post('/', async (req, res, next) => {
  try {
    const { _internals: { findExistingVocab } } = require('../../agent/pipeline');
    const { lookupLevel } = require('../../agent/middleware/jlpt-levels');
    const b = req.body || {};
    const romaji = String(b.word_romaji_macron || '').trim().toLowerCase();
    const meaning = String(b.meaning_en || '').trim();
    if (!romaji || !meaning) {
      return res.status(400).json({ error: 'Must provide "word_romaji_macron" and "meaning_en"' });
    }
    const word = {
      word_romaji_macron: romaji,
      word_kanji: b.word_kanji || null,
      word_kana: b.word_kana || null,
      meaning_en: meaning,
      part_of_speech: b.part_of_speech || null,
    };

    const existing = await findExistingVocab(word, req.userId);
    if (existing) return res.json(existing.data());

    const now = new Date().toISOString();
    const articleId = parseInt(b.article_id) || null;
    const vocabId = await getNextId('vocabulary');
    const doc = {
      id: vocabId,
      user_id: req.userId,
      word_romaji: romaji.replace(/[āīūēō]/g, c => ({ ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' })[c]),
      ...word,
      jlpt_level: lookupLevel(word),
      category: 'general',
      status: 'learning',
      times_seen: 1,
      times_tested: 0,
      times_tested_correct: 0,
      times_used_correctly: 0,
      streak_correct: 0,
      first_seen_in_article_id: articleId,
      first_seen_at: now,
      last_seen_at: now,
      last_tested_at: null,
      next_review_at: null,
    };
    await collections.vocabulary.doc(String(vocabId)).set(doc);

    // Link to the article so the word is underlined there and keeps its sentence
    if (articleId) {
      const avId = await getNextId('articleVocabulary');
      await collections.articleVocabulary.doc(String(avId)).set({
        id: avId,
        user_id: req.userId,
        article_id: articleId,
        vocabulary_id: vocabId,
        is_new: 0,
        is_review: 0,
        context_sentence: b.context_sentence ? String(b.context_sentence).slice(0, 400) : null,
      });
    }
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/vocabulary/:id — update word status
router.patch('/:id', async (req, res, next) => {
  try {
    const vocabId = parseInt(req.params.id);
    const { status } = req.body;
    const validStatuses = ['new', 'learning', 'known', 'mastered'];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const updates = {};
    if (status) updates.status = status;

    // Calculate next review date based on new status
    if (status === 'known') {
      updates.next_review_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 1 day
    } else if (status === 'mastered') {
      updates.next_review_at = null; // No more reviews needed
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const snapshot = await collections.vocabulary
      .where('id', '==', vocabId)
      .where('user_id', '==', req.userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Word not found' });
    }

    const docRef = snapshot.docs[0].ref;
    await docRef.update(updates);

    const updatedDoc = await docRef.get();
    res.json(updatedDoc.data());
  } catch (err) {
    next(err);
  }
});

// POST /api/vocabulary/:id/test — record a test result
router.post('/:id/test', async (req, res, next) => {
  try {
    const vocabId = parseInt(req.params.id);
    const { correct } = req.body;

    if (typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'Must provide "correct" (boolean)' });
    }

    const snapshot = await collections.vocabulary
      .where('id', '==', vocabId)
      .where('user_id', '==', req.userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Word not found' });
    }

    const docRef = snapshot.docs[0].ref;
    const word = snapshot.docs[0].data();

    // Update test counters
    const newTimesTested = word.times_tested + 1;
    const newTimesCorrect = word.times_tested_correct + (correct ? 1 : 0);
    const newStreak = correct ? word.streak_correct + 1 : 0;
    const newUsedCorrectly = word.times_used_correctly + (correct ? 1 : 0);

    // Determine if status should change based on vocabulary-management skill rules
    let newStatus = word.status;
    let nextReview = word.next_review_at;

    if (correct && word.status === 'learning') {
      if (word.times_seen >= 5 && newTimesCorrect >= 3 && newUsedCorrectly >= 2) {
        newStatus = 'known';
        nextReview = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }
    } else if (correct && word.status === 'known') {
      const reviewIntervals = [1, 3, 7, 14, 30];
      const reviewIndex = Math.min(newStreak - 1, reviewIntervals.length - 1);
      if (newStreak >= reviewIntervals.length) {
        newStatus = 'mastered';
        nextReview = null;
      } else {
        nextReview = new Date(Date.now() + reviewIntervals[reviewIndex] * 24 * 60 * 60 * 1000).toISOString();
      }
    } else if (!correct) {
      if (word.status === 'known' && newStreak === 0 && word.streak_correct === 0) {
        newStatus = 'learning';
        nextReview = null;
      } else if (word.status === 'mastered') {
        newStatus = 'known';
        nextReview = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }
    }

    await docRef.update({
      times_tested: newTimesTested,
      times_tested_correct: newTimesCorrect,
      streak_correct: newStreak,
      times_used_correctly: newUsedCorrectly,
      status: newStatus,
      next_review_at: nextReview,
      last_tested_at: new Date().toISOString(),
    });

    const updatedDoc = await docRef.get();
    res.json({ word: updatedDoc.data(), statusChanged: newStatus !== word.status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
