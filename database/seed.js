// Seed script — inserts sample data for development and testing.
// Run with: npm run seed (or: node database/seed.js)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../server/services/db');

console.log('Seeding database...');

const seed = db.transaction(() => {
  // 1. Insert a sample article
  const article1 = db.prepare(`
    INSERT INTO articles (title_romaji, summary_romaji, body_romaji, translation_en,
      grammar_points, sources, topic, region, word_count, new_word_count, review_word_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Doitsu no atarashii keizai seisaku',
    'Doitsu no Merz shushō wa atarashii keizai seisaku wo happyō shimashita. Kono seisaku wa kisei-kanwa to tōshi wo mokuteki to shite imasu.',
    `Doitsu no Merz shushō wa kinō, atarashii [NEW]keizai seisaku wo [NEW]happyō shimashita. Kono seisaku wa [NEW]kisei-kanwa to [NEW]tōshi wo mokuteki to shite imasu.

Merz shushō wa "Doitsu no keizai wa ima, ōkii [NEW]henka ga hitsuyō desu" to [NEW]hatsugen shimashita. [NEW]Seifu wa rainen kara atarashii [NEW]hōritsu wo [NEW]jisshi suru [NEW]keikaku desu.

[REVIEW]Keizai no [NEW]senmonka wa kono seisaku ni tsuite, "kore wa [NEW]jūyō na ippo desu" to [NEW]hyōka shimashita. Shikashi, [NEW]hantai no iken mo arimasu.

Reuters ni yoru to, kono seisaku wa Yōroppa no hoka no kuni nimo eikyō wo ataeru kamoshiremasen.`,
    `German Chancellor Merz announced a new economic policy yesterday. This policy aims at deregulation and investment.

Chancellor Merz stated that "Germany's economy now needs big changes." The government plans to implement new laws starting next year.

Economic experts have evaluated this policy as "an important step." However, there are also opposing opinions.

According to Reuters, this policy may also affect other European countries.`,
    JSON.stringify([
      {
        pattern: '~wo mokuteki to shite imasu',
        level: 'N3',
        explanation: 'Means "has the purpose/aim of ~". Used to describe the goal of a policy, plan, or action.',
        examples: [
          'Kono purojekuto wa kankyō hogo wo mokuteki to shite imasu.',
          'Kaigi wa mondai kaiketsu wo mokuteki to shite imasu.'
        ]
      }
    ]),
    JSON.stringify([
      { name: 'Reuters', url: 'https://reuters.com' },
      { name: 'Handelsblatt', url: 'https://handelsblatt.com' }
    ]),
    'Germany economic policy deregulation',
    'germany',
    180,
    13,
    1
  );
  const articleId = article1.lastInsertRowid;
  console.log(`Inserted article ID: ${articleId}`);

  // 2. Insert vocabulary for this article
  const vocabWords = [
    { romaji: 'keizai', macron: 'keizai', kanji: '経済', kana: 'けいざい', meaning: 'economy, economics', pos: 'noun', level: 'N3', cat: 'finance' },
    { romaji: 'happyou', macron: 'happyō', kanji: '発表', kana: 'はっぴょう', meaning: 'announcement, presentation', pos: 'noun', level: 'N3', cat: 'general' },
    { romaji: 'kisei-kanwa', macron: 'kisei-kanwa', kanji: '規制緩和', kana: 'きせいかんわ', meaning: 'deregulation', pos: 'noun', level: 'N3', cat: 'politics' },
    { romaji: 'toushi', macron: 'tōshi', kanji: '投資', kana: 'とうし', meaning: 'investment', pos: 'noun', level: 'N3', cat: 'finance' },
    { romaji: 'henka', macron: 'henka', kanji: '変化', kana: 'へんか', meaning: 'change, transformation', pos: 'noun', level: 'N3', cat: 'general' },
    { romaji: 'hatsugen', macron: 'hatsugen', kanji: '発言', kana: 'はつげん', meaning: 'statement, remark', pos: 'noun', level: 'N3', cat: 'politics' },
    { romaji: 'seifu', macron: 'seifu', kanji: '政府', kana: 'せいふ', meaning: 'government', pos: 'noun', level: 'N3', cat: 'politics' },
    { romaji: 'houritsu', macron: 'hōritsu', kanji: '法律', kana: 'ほうりつ', meaning: 'law, legislation', pos: 'noun', level: 'N3', cat: 'politics' },
    { romaji: 'jisshi', macron: 'jisshi', kanji: '実施', kana: 'じっし', meaning: 'implementation, enforcement', pos: 'noun', level: 'N3', cat: 'general' },
    { romaji: 'keikaku', macron: 'keikaku', kanji: '計画', kana: 'けいかく', meaning: 'plan, project', pos: 'noun', level: 'N4', cat: 'general' },
    { romaji: 'senmonka', macron: 'senmonka', kanji: '専門家', kana: 'せんもんか', meaning: 'expert, specialist', pos: 'noun', level: 'N3', cat: 'general' },
    { romaji: 'juuyou', macron: 'jūyō', kanji: '重要', kana: 'じゅうよう', meaning: 'important, significant', pos: 'adjective', level: 'N3', cat: 'general' },
    { romaji: 'hyouka', macron: 'hyōka', kanji: '評価', kana: 'ひょうか', meaning: 'evaluation, assessment', pos: 'noun', level: 'N3', cat: 'general' },
  ];

  const insertVocab = db.prepare(`
    INSERT INTO vocabulary (word_romaji, word_romaji_macron, word_kanji, word_kana,
      meaning_en, part_of_speech, jlpt_level, category, status, times_seen,
      first_seen_in_article_id, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'learning', 1, ?, CURRENT_TIMESTAMP)
  `);

  const insertLink = db.prepare(`
    INSERT INTO article_vocabulary (article_id, vocabulary_id, is_new, is_review, context_sentence)
    VALUES (?, ?, 1, 0, ?)
  `);

  for (const w of vocabWords) {
    const result = insertVocab.run(
      w.romaji, w.macron, w.kanji, w.kana,
      w.meaning, w.pos, w.level, w.cat,
      articleId
    );
    insertLink.run(articleId, result.lastInsertRowid,
      `Context sentence for ${w.macron}`);
  }
  console.log(`Inserted ${vocabWords.length} vocabulary words`);

  // 3. Insert quiz questions for this article
  const quizQuestions = [
    {
      type: 'meaning',
      q_romaji: '"keizai" wa Eigo de nan desu ka?',
      q_en: 'What does "keizai" mean in English?',
      answer: 'economy, economics',
      distractors: ['government', 'investment', 'announcement'],
      hint: 'This word is related to money and markets.'
    },
    {
      type: 'meaning',
      q_romaji: '"kisei-kanwa" wa Eigo de nan desu ka?',
      q_en: 'What does "kisei-kanwa" mean in English?',
      answer: 'deregulation',
      distractors: ['regulation', 'policy change', 'tax increase'],
      hint: 'It means reducing rules and restrictions.'
    },
    {
      type: 'context',
      q_romaji: 'Merz shushō wa atarashii keizai seisaku wo ___ shimashita.',
      q_en: 'Fill in the blank',
      answer: 'happyō',
      distractors: ['hatsugen', 'jisshi', 'hyōka'],
      hint: 'This word means to announce or present.'
    },
    {
      type: 'comprehension',
      q_romaji: 'Merz shushō wa nani wo teian shimashita ka?',
      q_en: 'What did Chancellor Merz propose?',
      answer: 'Atarashii keizai seisaku (kisei-kanwa to tōshi)',
      distractors: ['Zōzei (tax increase)', 'Gaikō seisaku (foreign policy)', 'Kyōiku kaikaku (education reform)'],
      hint: 'Read the first paragraph of the article.'
    },
    {
      type: 'correction',
      q_romaji: 'Fix the romaji: "Toukyou no joukyou wa teichou desu"',
      q_en: 'Correct the macrons',
      answer: 'Tōkyō no jōkyō wa teichō desu',
      distractors: [],
      hint: 'Long vowels need macrons: ou → ō'
    },
    {
      type: 'meaning',
      q_romaji: '"jūyō" wa Eigo de nan desu ka?',
      q_en: 'What does "jūyō" mean in English?',
      answer: 'important, significant',
      distractors: ['difficult', 'expensive', 'famous'],
      hint: 'Experts described the policy with this word.'
    },
    {
      type: 'comprehension',
      q_romaji: 'Senmonka wa kono seisaku wo dō hyōka shimashita ka?',
      q_en: 'How did experts evaluate this policy?',
      answer: 'Jūyō na ippo (an important step)',
      distractors: ['Mondai ga ōi (many problems)', 'Amari yoku nai (not very good)', 'Mada wakaranai (still unknown)'],
      hint: 'Look at the third paragraph.'
    },
  ];

  const insertQuiz = db.prepare(`
    INSERT INTO quiz_questions (article_id, type, question_romaji, question_en,
      correct_answer, distractors, hint)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const q of quizQuestions) {
    insertQuiz.run(articleId, q.type, q.q_romaji, q.q_en,
      q.answer, JSON.stringify(q.distractors), q.hint);
  }
  console.log(`Inserted ${quizQuestions.length} quiz questions`);
});

seed();
console.log('Seed complete!');

// Verify
const articleCount = db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
const vocabCount = db.prepare('SELECT COUNT(*) as count FROM vocabulary').get().count;
const quizCount = db.prepare('SELECT COUNT(*) as count FROM quiz_questions').get().count;
console.log(`Database now has: ${articleCount} articles, ${vocabCount} vocabulary words, ${quizCount} quiz questions`);
