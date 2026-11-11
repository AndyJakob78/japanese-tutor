// Article routes
// POST /api/articles/generate — trigger article generation pipeline
// GET  /api/articles — list all articles (paginated)
// GET  /api/articles/:id — get full article with vocabulary + quiz
// GET  /api/articles/:id/speech(/:index) — read-aloud sentences / MP3 per sentence
// PATCH /api/articles/:id — mark as read
// DELETE /api/articles/:id — delete article and optionally its vocabulary

const express = require('express');
const router = express.Router();
const { collections } = require('../services/firestore');
const { runPipeline, getArticleWithDetails } = require('../../agent/pipeline');
const { checkTrialStatus, incrementGenerationCount, FREE_TRIAL_LIMIT } = require('../services/deviceService');
const { spellOutNumbers, spellOutArticle } = require('../../agent/middleware/spell-numbers');
const { _internals: { fixStoredSpelling } } = require('../../agent/middleware/spell-numbers');

// POST /api/articles/generate — trigger the full generation pipeline
// Enforces hard paywall: 3 free articles per device, then Pro required.
router.post('/generate', async (req, res, next) => {
  try {
    const deviceId = req.userId; // X-User-ID doubles as device ID

    // ── Step A+B: Check trial authorization ──────────────────────────────────
    const trial = await checkTrialStatus(deviceId);

    if (!trial.allowed) {
      return res.status(403).json({
        error:            'TRIAL_EXHAUSTED',
        message:          `You have used your ${FREE_TRIAL_LIMIT} free articles. Please upgrade to Pro to continue generating.`,
        generation_count: trial.generationCount,
        limit:            FREE_TRIAL_LIMIT,
      });
    }

    // ── Track client disconnect (screen lock / app backgrounded) ───────────
    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    // ── Step C: Run the Claude pipeline ──────────────────────────────────────
    const overrides = {};
    if (req.body.region)              overrides.region              = req.body.region;
    if (req.body.proficiency_level)   overrides.proficiency_level   = req.body.proficiency_level;
    if (req.body.new_words_per_article) overrides.new_words_per_article = req.body.new_words_per_article;
    if (req.body.target_word_count)   overrides.target_word_count   = req.body.target_word_count;
    if (req.body.writing_system)      overrides.writing_system      = req.body.writing_system;
    if (req.body.custom_topic)        overrides.custom_topic        = req.body.custom_topic;

    console.log(`[GENERATE] user=${req.userId.substring(0, 8)}... overrides=${JSON.stringify(overrides)}`);
    const article = await runPipeline(overrides, req.userId);

    // Increment ONLY after success — failed Claude calls don't cost a trial slot
    if (!trial.isPro) {
      await incrementGenerationCount(deviceId);
    }

    // ── Send response, handling client disconnect gracefully ────────────────
    if (clientDisconnected) {
      console.log(`[GENERATE] Article ${article.id} saved OK but client disconnected (screen lock / app backgrounded). User will see it on next refresh.`);
      return; // article is in DB — nothing more to do
    }

    try {
      res.status(201).json(spellOutArticle(article));
    } catch (writeErr) {
      // Connection died between our check and the write — still fine
      console.log(`[GENERATE] Article ${article.id} saved OK but response write failed (client gone). User will see it on next refresh.`);
    }
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
      const romaji = !data.writing_system || data.writing_system === 'romaji';
      return {
        id: data.id,
        // same display fixes as the article screen (list showed "vyira" while the article said "vira")
        title_romaji: romaji ? spellOutNumbers(fixStoredSpelling(data.title_romaji)) : data.title_romaji,
        summary_romaji: romaji ? spellOutNumbers(fixStoredSpelling(data.summary_romaji)) : data.summary_romaji,
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

    res.json(spellOutArticle(article));
  } catch (err) {
    next(err);
  }
});

/** Only the article document (no vocabulary/quiz) — the read-aloud player calls this once per sentence. */
async function loadArticleText(id, userId) {
  const snap = await collections.articles
    .where('id', '==', parseInt(id, 10))
    .where('user_id', '==', userId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
}

// GET /api/articles/:id/speech — sentences for the read-aloud player (2026-11-11)
// The app plays /speech/:index one by one; the text is the same display text
// the article screen shows (spellOutArticle).
router.get('/:id/speech', async (req, res, next) => {
  try {
    const { VOICES, DEFAULT_VOICE, splitSentences } = require('../services/speech');
    const article = await loadArticleText(req.params.id, req.userId);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json({ voices: Object.keys(VOICES), default_voice: DEFAULT_VOICE, sentences: splitSentences(spellOutArticle(article).body_romaji) });
  } catch (err) {
    next(err);
  }
});

// GET /api/articles/:id/speech/:index — MP3 of one sentence (cached after the first play)
router.get('/:id/speech/:index', async (req, res, next) => {
  try {
    const { splitSentences, sentenceAudio } = require('../services/speech');
    const article = await loadArticleText(req.params.id, req.userId);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const sentences = splitSentences(spellOutArticle(article).body_romaji);
    const i = parseInt(req.params.index, 10);
    if (!(i >= 0 && i < sentences.length)) return res.status(404).json({ error: 'No such sentence' });
    const audio = await sentenceAudio(sentences[i], String(req.query.voice || ''));
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' });
    res.send(audio);
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
