// Storage for German / English articles and vocabulary.
//
// Each language has its own collections (see collectionsFor in
// server/services/firestore.js). An article is ONE document that already
// holds its vocabulary and quiz, so opening an article is a single read.
// The vocabulary collection is the learner's word list across articles.
//
// The store gets its collections handed in, so the tests can run it against
// a fake database and never touch the live one.

const { applyTest, answerParts } = require('./learn');
const { applyTestResult } = require('../server/services/word-schedule');

// Words carry a small number per learner (num_id): the app's shared screens
// use whole numbers as word ids, like the Japanese word list does.
const maxNum = docs => docs.reduce((m, d) => Math.max(m, d.data().num_id || 0), 0);

// review state of a word that was never tested
const NEW_WORD = { status: 'new', times_seen: 1, times_tested: 0, times_tested_correct: 0, streak_correct: 0, next_review_at: null, last_tested_at: null };

/** Pipeline output → the document we store (neutral field names). */
function toStored(a, id, userId) {
  const now = new Date().toISOString();
  return {
    id, user_id: userId, language: a.language, level: a.level, explain_language: 'ja',
    topic: a.topic || '', region: a.region || '', category: a.category || '', title: a.title, summary: a.summary, body: a.body, translation: a.translation_ja,
    vocabulary: (a.vocabulary || []).map(v => ({
      word: v.word, base: v.base || v.word, pos: v.pos || '', meaning: v.meaning_ja || '',
      example: v.example || '', example_translation: v.example_ja || '',
    })),
    grammar_note: a.grammar_note ? { point: a.grammar_note.point, explanation: a.grammar_note.explanation_ja, sentence: a.grammar_note.sentence } : null,
    quiz: (a.quiz || []).map(q => ({
      type: q.type, instruction: q.instruction_ja, question: q.question, options: q.options,
      answer_index: q.answer_index, explanation: q.explanation_ja,
    })),
    // words from earlier articles that come back in this one ([REVIEW] in the body)
    review_vocabulary: (a.review_vocabulary || []).map(v => ({ word: v.word, base: v.base, pos: v.pos || '', meaning: v.meaning || '', example: v.example || '', example_translation: v.example_translation || '' })),
    sources: a.sources || [],
    word_count: a.word_count || 0, new_word_count: (a.vocabulary || []).length,
    lint_warnings: a.lint_warnings || [], reviewer_fixes: a._reviewer_fixes || [],
    created_at: now, read_at: null, quiz_completed_at: null, quiz_score: null,
  };
}

const listItem = d => ({
  id: d.id, language: d.language, level: d.level, title: d.title, summary: d.summary, topic: d.topic, region: d.region || '', category: d.category || '',
  review_word_count: (d.review_vocabulary || []).length,
  word_count: d.word_count, new_word_count: d.new_word_count, created_at: d.created_at,
  read_at: d.read_at, quiz_completed_at: d.quiz_completed_at, quiz_score: d.quiz_score,
});

/**
 * @param {{articles, vocabulary}} cols  Firestore collections of ONE language
 * @param {() => Promise<number>} nextId  gives the next article number
 */
function createStore(cols, nextId) {
  async function userDocs(col, userId) {
    const snap = await col.where('user_id', '==', userId).get();
    return snap.docs;
  }

  async function getOwned(id, userId) {
    const ref = cols.articles.doc(String(id));
    const doc = await ref.get();
    if (!doc.exists || doc.data().user_id !== userId) return null; // someone else's article looks like "not found"
    return { ref, data: doc.data() };
  }

  return {
    async saveArticle(userId, article) {
      const id = await nextId();
      const stored = toStored(article, id, userId);
      await cols.articles.doc(String(id)).set(stored);

      // word list: one entry per dictionary form and learner
      const mine = await userDocs(cols.vocabulary, userId);
      const existing = new Map(mine.map(d => [String(d.data().base).toLowerCase(), d]));
      let num = maxNum(mine);
      for (const v of stored.vocabulary) {
        const hit = existing.get(String(v.base).toLowerCase());
        if (hit) await hit.ref.update({ times_seen: (hit.data().times_seen || 1) + 1, last_seen_at: stored.created_at, last_article_id: id });
        else await cols.vocabulary.doc().set({ ...v, ...NEW_WORD, num_id: ++num, user_id: userId, first_article_id: id, last_article_id: id, created_at: stored.created_at, last_seen_at: stored.created_at });
      }
      for (const v of stored.review_vocabulary) {
        const hit = existing.get(String(v.base).toLowerCase());
        if (hit) await hit.ref.update({ times_seen: (hit.data().times_seen || 1) + 1, last_seen_at: stored.created_at, last_article_id: id });
      }
      return stored;
    },

    async listArticles(userId, page = 1, limit = 20) {
      const all = (await userDocs(cols.articles, userId)).map(d => d.data())
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return { articles: all.slice((page - 1) * limit, page * limit).map(listItem), pagination: { page, limit, total: all.length, pages: Math.ceil(all.length / limit) } };
    },

    async getArticle(id, userId) {
      const hit = await getOwned(id, userId);
      return hit ? hit.data : null;
    },

    async markRead(id, userId) {
      const hit = await getOwned(id, userId);
      if (!hit) return null;
      const read_at = new Date().toISOString();
      await hit.ref.update({ read_at });
      return { ...hit.data, read_at };
    },

    /** @param {number[]} answers  chosen option per question */
    async submitQuiz(id, userId, answers) {
      const hit = await getOwned(id, userId);
      if (!hit) return null;
      const results = (hit.data.quiz || []).map((q, i) => ({
        question: q.question, chosen: answers[i] ?? null, answer_index: q.answer_index,
        correct: answers[i] === q.answer_index, explanation: q.explanation,
      }));
      const total = results.length;
      const correct = results.filter(r => r.correct).length;
      const quiz_score = total ? Math.round((correct / total) * 100) : 0;
      await hit.ref.update({ quiz_completed_at: new Date().toISOString(), quiz_score });
      return { correct, total, score: quiz_score, results };
    },

    /** The words stay in the learner's word list unless deleteVocabulary is set (then: the words first met in this article). */
    async deleteArticle(id, userId, { deleteVocabulary = false } = {}) {
      const hit = await getOwned(id, userId);
      if (!hit) return false;
      let words = 0;
      if (deleteVocabulary) {
        for (const d of await userDocs(cols.vocabulary, userId)) {
          if (String(d.data().first_article_id) === String(id)) { await d.ref.delete(); words++; }
        }
      }
      await hit.ref.delete();
      return { deleted: true, vocabulary_deleted_count: words };
    },

    async listVocabulary(userId) {
      return (await userDocs(cols.vocabulary, userId)).map(d => ({ ...NEW_WORD, ...d.data(), id: d.id, ...answerParts(d.data().base) }))
        .sort((a, b) => (b.last_seen_at || '').localeCompare(a.last_seen_at || ''));
    },

    /** The word list with a number on every word (words from before the numbers get theirs here, once). */
    async listVocabularyNumbered(userId) {
      const docs = await userDocs(cols.vocabulary, userId);
      let num = maxNum(docs);
      const numbers = new Map();
      for (const d of docs) if (!d.data().num_id) numbers.set(d.id, ++num);
      await Promise.all(docs.filter(d => numbers.has(d.id)).map(d => d.ref.update({ num_id: numbers.get(d.id) })));
      return docs.map(d => ({ ...NEW_WORD, ...d.data(), id: d.id, num_id: d.data().num_id || numbers.get(d.id), ...answerParts(d.data().base) }))
        .sort((a, b) => (b.last_seen_at || '').localeCompare(a.last_seen_at || ''));
    },

    /** Document id of the learner's word with this number, or null. */
    async wordIdByNumber(num, userId) {
      const hit = (await userDocs(cols.vocabulary, userId)).find(d => d.data().num_id === Number(num));
      return hit ? hit.id : null;
    },

    async listAllArticles(userId) {
      return (await userDocs(cols.articles, userId)).map(d => d.data());
    },

    /** Add a word the learner looked up. Returns the existing entry if it is already there. */
    async addWord(userId, entry) {
      const all = await userDocs(cols.vocabulary, userId);
      const hit = all.find(d => String(d.data().base).toLowerCase() === String(entry.base).toLowerCase());
      if (hit) return { ...NEW_WORD, ...hit.data(), id: hit.id, existed: true };
      const now = new Date().toISOString();
      const ref = cols.vocabulary.doc();
      const doc = {
        num_id: maxNum(all) + 1,
        word: entry.word || entry.base, base: entry.base, pos: entry.pos || '', meaning: entry.meaning, example: entry.example || '',
        example_translation: entry.example_translation || '', ...NEW_WORD, user_id: userId,
        first_article_id: entry.article_id || null, last_article_id: entry.article_id || null, created_at: now, last_seen_at: now, added_by_learner: true,
      };
      await ref.set(doc);
      return { ...doc, id: ref.id, existed: false };
    },

    async getWord(id, userId) {
      const ref = cols.vocabulary.doc(String(id));
      const doc = await ref.get();
      if (!doc.exists || doc.data().user_id !== userId) return null;
      return { ref, data: { ...NEW_WORD, ...doc.data(), id: doc.id } };
    },

    /**
     * Record one review answer and move the word's schedule.
     * With a `mode` ("typed" | "sentence" | "choice") the Japanese rule applies:
     * only recall (typed, own sentence) can make a word "known". Without a mode
     * (app 1.5, where every review is typed) the first rule stays.
     */
    async testWord(id, userId, correct, mode) {
      const hit = await this.getWord(id, userId);
      if (!hit) return null;
      // a first test moves a new word to "learning"
      const change = mode ? applyTestResult({ ...hit.data, status: hit.data.status === 'new' ? 'learning' : hit.data.status }, correct, mode) : applyTest(hit.data, correct);
      // the day a word became "known" — the progress screen's pace is counted from it
      const becameKnown = change.status === 'known' && hit.data.status !== 'known' && hit.data.status !== 'mastered';
      if (becameKnown) change.known_at = new Date().toISOString();
      await hit.ref.update(change);
      return { word: { ...hit.data, ...change, ...answerParts(hit.data.base) }, statusChanged: change.status !== hit.data.status, becameKnown };
    },

    async setWordStatus(id, userId, status) {
      const hit = await this.getWord(id, userId);
      if (!hit) return null;
      await hit.ref.update({ status });
      return { ...hit.data, status };
    },

    async deleteWord(id, userId) {
      const hit = await this.getWord(id, userId);
      if (!hit) return false;
      await hit.ref.delete();
      return true;
    },

    /** Save the corrections of one practice sentence. Never throws. */
    async saveMistakes(userId, { fixes, sentence, corrected }) {
      if (!fixes || !fixes.length || process.env.MISTAKES_READONLY === '1') return 0;
      try {
        const now = new Date().toISOString();
        for (const f of fixes) {
          await cols.mistakes.doc().set({ user_id: userId, created_at: now, type: f.type, pattern: f.pattern, wrote: f.wrote, correct: f.correct, why: f.why, sentence: String(sentence).slice(0, 300), corrected: String(corrected).slice(0, 300) });
        }
        return fixes.length;
      } catch (err) { console.error('saveMistakes failed:', err.message); return 0; }
    },

    /** The learner's mistakes of the last 60 days, newest first. */
    async listMistakes(userId, days = 60) {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      return (await userDocs(cols.mistakes, userId)).map(d => d.data())
        .filter(m => Date.parse(m.created_at) >= since)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(({ user_id, ...m }) => m);
    },
  };
}

module.exports = { createStore, toStored };
