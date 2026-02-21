// Quiz routes
// GET  /api/articles/:id/quiz — get quiz questions for an article
// POST /api/articles/:id/quiz — submit quiz answers and update scores

const express = require('express');
const router = express.Router();
const { firestore, collections } = require('../services/firestore');

// GET /api/articles/:id/quiz — get quiz for article
router.get('/:id/quiz', async (req, res, next) => {
  try {
    const articleId = parseInt(req.params.id);

    const articleSnapshot = await collections.articles
      .where('id', '==', articleId)
      .where('user_id', '==', req.userId)
      .limit(1)
      .get();

    if (articleSnapshot.empty) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const article = articleSnapshot.docs[0].data();

    // Fetch questions and sort in code to avoid composite Firestore index
    const questionsSnapshot = await collections.quizQuestions
      .where('article_id', '==', articleId)
      .where('user_id', '==', req.userId)
      .get();

    const questions = questionsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id,
        type: data.type,
        question_romaji: data.question_romaji,
        question_en: data.question_en,
        correct_answer: data.correct_answer,
        distractors: data.distractors || [],
        hint: data.hint,
        vocabulary_id: data.vocabulary_id,
        answered_correctly: data.answered_correctly,
        answered_at: data.answered_at,
      };
    });
    questions.sort((a, b) => (a.id || 0) - (b.id || 0));

    res.json({
      article_id: article.id,
      article_title: article.title_romaji,
      questions,
      total: questions.length,
      answered: questions.filter(q => q.answered_at !== null && q.answered_at !== undefined).length,
      correct: questions.filter(q => q.answered_correctly === 1 || q.answered_correctly === true).length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/articles/:id/quiz — submit quiz answers
router.post('/:id/quiz', async (req, res, next) => {
  try {
    const articleId = parseInt(req.params.id);
    const { answers } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: 'Must provide "answers" array with { question_id, answer }' });
    }

    const articleSnapshot = await collections.articles
      .where('id', '==', articleId)
      .where('user_id', '==', req.userId)
      .limit(1)
      .get();

    if (articleSnapshot.empty) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const articleDocRef = articleSnapshot.docs[0].ref;

    const results = [];
    let correctCount = 0;

    const batch = firestore.batch();

    for (const { question_id, answer } of answers) {
      const qSnapshot = await collections.quizQuestions
        .where('id', '==', question_id)
        .where('article_id', '==', articleId)
        .where('user_id', '==', req.userId)
        .limit(1)
        .get();

      if (qSnapshot.empty) {
        results.push({ question_id, error: 'Question not found' });
        continue;
      }

      const qDocRef = qSnapshot.docs[0].ref;
      const question = qSnapshot.docs[0].data();

      const isCorrect = answer.trim().toLowerCase() === question.correct_answer.trim().toLowerCase();
      if (isCorrect) correctCount++;

      batch.update(qDocRef, {
        answered_correctly: isCorrect ? 1 : 0,
        answered_at: new Date().toISOString(),
      });

      // Update vocabulary test results if linked
      if (question.vocabulary_id) {
        const vocabSnapshot = await collections.vocabulary
          .where('id', '==', question.vocabulary_id)
          .where('user_id', '==', req.userId)
          .limit(1)
          .get();

        if (!vocabSnapshot.empty) {
          const vocabDocRef = vocabSnapshot.docs[0].ref;
          const word = vocabSnapshot.docs[0].data();

          batch.update(vocabDocRef, {
            times_tested: word.times_tested + 1,
            times_tested_correct: word.times_tested_correct + (isCorrect ? 1 : 0),
            times_used_correctly: word.times_used_correctly + (isCorrect ? 1 : 0),
            streak_correct: isCorrect ? word.streak_correct + 1 : 0,
            last_tested_at: new Date().toISOString(),
          });
        }
      }

      results.push({
        question_id,
        correct: isCorrect,
        your_answer: answer,
        correct_answer: question.correct_answer,
        hint: isCorrect ? null : question.hint,
      });
    }

    // Update article quiz score
    const totalQuestionsSnapshot = await collections.quizQuestions
      .where('article_id', '==', articleId)
      .where('user_id', '==', req.userId)
      .count()
      .get();
    const totalQuestions = totalQuestionsSnapshot.data().count;

    const score = totalQuestions > 0 ? correctCount / answers.length : 0;
    batch.update(articleDocRef, {
      quiz_score: score,
      quiz_completed_at: new Date().toISOString(),
    });

    await batch.commit();

    res.json({
      results,
      score: {
        correct: correctCount,
        total: answers.length,
        percentage: Math.round((correctCount / answers.length) * 100),
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
