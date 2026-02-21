// Stats routes
// GET /api/stats — overall learning statistics
// GET /api/stats/vocabulary — vocabulary growth over time
// GET /api/stats/quiz-history — quiz score history

const express = require('express');
const router = express.Router();
const { collections } = require('../services/firestore');

// GET /api/stats — overall learning statistics (per-user)
router.get('/', async (req, res, next) => {
  try {
    // Fetch this user's vocabulary docs
    const vocabSnapshot = await collections.vocabulary
      .where('user_id', '==', req.userId)
      .get();
    const allVocab = vocabSnapshot.docs.map(doc => doc.data());

    const totalWords = allVocab.length;
    const statusCounts = { new: 0, learning: 0, known: 0, mastered: 0 };
    const levelCounts = {};

    const now = new Date().toISOString();
    let dueForReview = 0;

    for (const word of allVocab) {
      if (statusCounts.hasOwnProperty(word.status)) {
        statusCounts[word.status]++;
      }

      if (word.jlpt_level) {
        levelCounts[word.jlpt_level] = (levelCounts[word.jlpt_level] || 0) + 1;
      }

      if (
        (word.status === 'learning' || word.status === 'known') &&
        word.next_review_at &&
        word.next_review_at <= now
      ) {
        dueForReview++;
      }
    }

    const byLevel = Object.entries(levelCounts)
      .map(([jlpt_level, count]) => ({ jlpt_level, count }))
      .sort((a, b) => a.jlpt_level.localeCompare(b.jlpt_level));

    // Fetch this user's articles
    const articlesSnapshot = await collections.articles
      .where('user_id', '==', req.userId)
      .get();
    const allArticles = articlesSnapshot.docs.map(doc => doc.data());

    const totalArticles = allArticles.length;
    const readArticles = allArticles.filter(a => a.read_at).length;
    const quizzedArticles = allArticles.filter(a => a.quiz_completed_at).length;

    const quizScores = allArticles
      .filter(a => a.quiz_score !== null && a.quiz_score !== undefined)
      .map(a => a.quiz_score);
    const avgQuizScore = quizScores.length > 0
      ? quizScores.reduce((sum, s) => sum + s, 0) / quizScores.length
      : null;

    // Calculate streak (consecutive days with articles read)
    const readDays = allArticles
      .filter(a => a.read_at)
      .map(a => a.read_at.split('T')[0])
      .filter(Boolean);
    const uniqueDays = [...new Set(readDays)].sort().reverse();

    let streak = 0;
    for (let i = 0; i < uniqueDays.length; i++) {
      const expected = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      if (uniqueDays[i] === expected) {
        streak++;
      } else {
        break;
      }
    }

    res.json({
      vocabulary: {
        total: totalWords,
        byStatus: statusCounts,
        byLevel,
        dueForReview,
      },
      articles: {
        total: totalArticles,
        read: readArticles,
        quizzed: quizzedArticles,
      },
      quiz: {
        averageScore: avgQuizScore ? Math.round(avgQuizScore * 100) : null,
      },
      streak,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/vocabulary — vocabulary growth over time (per-user)
router.get('/vocabulary', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const snapshot = await collections.vocabulary
      .where('user_id', '==', req.userId)
      .get();
    const allVocab = snapshot.docs.map(doc => doc.data());

    let cumulativeBase = 0;
    const dailyCounts = {};

    for (const word of allVocab) {
      if (!word.first_seen_at) continue;

      if (word.first_seen_at < cutoffDate) {
        cumulativeBase++;
      } else {
        const day = word.first_seen_at.split('T')[0];
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      }
    }

    const sortedDays = Object.keys(dailyCounts).sort();
    let cumulative = cumulativeBase;

    const data = sortedDays.map(day => {
      cumulative += dailyCounts[day];
      return { day, new_words: dailyCounts[day], total: cumulative };
    });

    res.json({ period_days: days, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/quiz-history — quiz score history (per-user)
router.get('/quiz-history', async (req, res, next) => {
  try {
    const limitCount = parseInt(req.query.limit) || 20;

    const snapshot = await collections.articles
      .where('user_id', '==', req.userId)
      .get();
    const allArticles = snapshot.docs.map(doc => doc.data());

    const quizzed = allArticles
      .filter(a => a.quiz_completed_at)
      .sort((a, b) => (b.quiz_completed_at || '').localeCompare(a.quiz_completed_at || ''))
      .slice(0, limitCount);

    const scores = quizzed.map(h => ({
      id: h.id,
      title_romaji: h.title_romaji,
      topic: h.topic,
      quiz_score: h.quiz_score,
      quiz_completed_at: h.quiz_completed_at,
      new_word_count: h.new_word_count,
      quiz_score_percent: h.quiz_score ? Math.round(h.quiz_score * 100) : null,
    }));

    res.json({ history: scores });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
