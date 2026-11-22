// GET /api/progress — everything the progress screen shows (Japanese course).
// The rules live in server/services/progress.js and are described in PROGRESS_SCREEN.md.
// German / English answer the same URL from multilang/server.js.

const express = require('express');
const router = express.Router();
const { collections } = require('../services/firestore');
const { buildProgress } = require('../services/progress');
const { loadRecord, saveRecord, tzOf } = require('../services/progress-store');
const { loadMistakes, patternKeyOf, PATTERNS, TYPE_LABELS } = require('../services/mistakes');

router.get('/', async (req, res, next) => {
  try {
    const mine = col => col.where('user_id', '==', req.userId).get().then(s => s.docs.map(d => d.data()));
    const [words, articles, config, mistakes, record] = await Promise.all([
      mine(collections.vocabulary), mine(collections.articles), mine(collections.config), loadMistakes(req.userId), loadRecord(req.userId, 'ja'),
    ]);
    const level = (config.find(c => c.key === 'proficiency_level') || {}).value || 'N4';
    const result = buildProgress({
      lang: 'ja', level: String(level).replace(/"/g, ''),
      words: words.map(w => ({ ...w, level: w.jlpt_level })),
      articles,
      mistakes: mistakes.map(m => {
        const p = PATTERNS.find(x => x.key === patternKeyOf(m)) || {};
        return { key: p.key || 'other', label: p.label || m.pattern, type_label: TYPE_LABELS[p.type] || 'Other', created_at: m.created_at, wrote: m.wrote, correct: m.correct, why: m.why };
      }),
      record, tzOffsetMin: tzOf(req),
    });
    const { save, ...body } = result;
    if (save) await saveRecord(req.userId, 'ja', save); // Monday's estimate, newly earned badges
    res.json(body);
  } catch (err) { next(err); }
});

module.exports = router;
