// Article routes
// POST /api/articles/generate — trigger article generation pipeline
// GET  /api/articles — list all articles (paginated)
// GET  /api/articles/:id — get full article with vocabulary + quiz
// PATCH /api/articles/:id — mark as read
// DELETE /api/articles/:id — delete article and optionally its vocabulary

const express = require('express');
const router = express.Router();
const { collections } = require('../services/firestore');
const { runPipeline, getArticleWithDetails } = require('../../agent/pipeline');

// POST /api/articles/generate — trigger the full generation pipeline
router.post('/generate', async (req, res, next) => {
  try {
    const overrides = {};
    if (req.body.topic) overrides.topic = req.body.topic;
    if (req.body.region) overrides.region = req.body.region;
    if (req.body.proficiency_level) overrides.proficiency_level = req.body.proficiency_level;
    if (req.body.new_words_per_article) overrides.new_words_per_article = req.body.new_words_per_article;
    if (req.body.target_word_count) overrides.target_word_count = req.body.target_word_count;
    if (req.body.writing_system) overrides.writing_system = req.body.writing_system;

    const article = await runPipeline(overrides, req.userId);
    res.status(201).json(article);
  } catch (err) {
    next(err);
  }
});

// GET /api/articles — list articles (paginated)
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    // Fetch all user's articles and sort/paginate in code
    // (avoids needing composite Firestore index for user_id + created_at)
    const allSnapshot = await collections.articles
      .where('user_id', '==', req.userId)
      .get();

    const allArticles = allSnapshot.docs.map(doc => doc.data());
    allArticles.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const articlesSnapshot = { docs: allArticles.slice(offset, offset + limit).map(data => ({ data: () => data })) };

    const articles = articlesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id,
        title_romaji: data.title_romaji,
        summary_romaji: data.summary_romaji,
        topic: data.topic,
        region: data.region,
        word_count: data.word_count,
        new_word_count: data.new_word_count,
        review_word_count: data.review_word_count,
        difficulty_score: data.difficulty_score,
        created_at: data.created_at,
        read_at: data.read_at,
        quiz_completed_at: data.quiz_completed_at,
        quiz_score: data.quiz_score,
        writing_system: data.writing_system || 'romaji',
      };
    });

    const total = allArticles.length;

    res.json({
      articles,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/articles/:id — get full article with vocabulary and quiz
router.get('/:id', async (req, res, next) => {
  try {
    const article = await getArticleWithDetails(req.params.id, req.userId);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/articles/:id — mark as read
router.patch('/:id', async (req, res, next) => {
  try {
    const articleId = parseInt(req.params.id);
    const updates = {};

    if (req.body.read_at !== undefined) {
      updates.read_at = typeof req.body.read_at === 'string' ? req.body.read_at : new Date().toISOString();
    }
    if (req.body.quiz_completed_at !== undefined) {
      updates.quiz_completed_at = typeof req.body.quiz_completed_at === 'string' ? req.body.quiz_completed_at : new Date().toISOString();
    }
    if (req.body.quiz_score !== undefined) {
      updates.quiz_score = req.body.quiz_score;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const snapshot = await collections.articles
      .where('id', '==', articleId)
      .where('user_id', '==', req.userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Article not found' });
    }

    await snapshot.docs[0].ref.update(updates);

    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/articles/:id — delete article and optionally its vocabulary
router.delete('/:id', async (req, res, next) => {
  try {
    const articleId = parseInt(req.params.id);
    const deleteVocabulary = req.query.delete_vocabulary === 'true';
    console.log(`[DELETE] Article ${articleId}, deleteVocabulary=${deleteVocabulary}, user=${req.userId.substring(0, 8)}`);

    const articleSnapshot = await collections.articles
      .where('id', '==', articleId)
      .where('user_id', '==', req.userId)
      .limit(1)
      .get();

    if (articleSnapshot.empty) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const batch = require('../services/firestore').firestore.batch();

    // 1. Get article_vocabulary joins for this article
    const avSnapshot = await collections.articleVocabulary
      .where('article_id', '==', articleId)
      .where('user_id', '==', req.userId)
      .get();

    const vocabIdsToCheck = [];
    for (const avDoc of avSnapshot.docs) {
      const av = avDoc.data();
      vocabIdsToCheck.push(av.vocabulary_id);
      batch.delete(avDoc.ref);
    }

    // 2. Delete quiz questions
    const quizSnapshot = await collections.quizQuestions
      .where('article_id', '==', articleId)
      .where('user_id', '==', req.userId)
      .get();
    for (const doc of quizSnapshot.docs) {
      batch.delete(doc.ref);
    }

    // 3. Delete news cache entries
    const cacheSnapshot = await collections.newsCache
      .where('used_in_article_id', '==', articleId)
      .where('user_id', '==', req.userId)
      .get();
    for (const doc of cacheSnapshot.docs) {
      batch.delete(doc.ref);
    }

    // 4. Optionally delete vocabulary words (only if they aren't used by other articles)
    let deletedVocabCount = 0;
    if (deleteVocabulary && vocabIdsToCheck.length > 0) {
      for (const vocabId of vocabIdsToCheck) {
        const allUsageSnapshot = await collections.articleVocabulary
          .where('vocabulary_id', '==', vocabId)
          .where('user_id', '==', req.userId)
          .get();

        const otherUsages = allUsageSnapshot.docs.filter(d => d.data().article_id !== articleId);
        if (otherUsages.length === 0) {
          const vocabSnapshot = await collections.vocabulary
            .where('id', '==', vocabId)
            .where('user_id', '==', req.userId)
            .limit(1)
            .get();
          if (!vocabSnapshot.empty) {
            batch.delete(vocabSnapshot.docs[0].ref);
            deletedVocabCount++;
          }
        }
      }
    }

    // 5. Delete the article itself
    batch.delete(articleSnapshot.docs[0].ref);

    await batch.commit();

    res.json({
      deleted: true,
      article_id: articleId,
      deleted_vocabulary: deleteVocabulary,
      vocabulary_deleted_count: deletedVocabCount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
