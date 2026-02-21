// Config routes
// GET /api/config — get all configuration
// PUT /api/config — update configuration
// GET /api/config/sources — get available news sources

const express = require('express');
const router = express.Router();
const { firestore, collections } = require('../services/firestore');

// GET /api/config — get all config (per-user)
router.get('/', async (req, res, next) => {
  try {
    const snapshot = await collections.config
      .where('user_id', '==', req.userId)
      .get();
    const config = {};
    for (const doc of snapshot.docs) {
      const data = doc.data();
      try {
        config[data.key] = JSON.parse(data.value);
      } catch {
        config[data.key] = data.value;
      }
    }
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/config — update config values (per-user)
router.put('/', async (req, res, next) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Must provide an object of key-value pairs' });
    }

    // Get this user's valid config keys
    const snapshot = await collections.config
      .where('user_id', '==', req.userId)
      .get();
    const validDocs = {};
    for (const doc of snapshot.docs) {
      validDocs[doc.data().key] = doc.ref;
    }
    const errors = [];

    const batch = firestore.batch();

    for (const [key, value] of Object.entries(updates)) {
      if (!validDocs[key]) {
        errors.push(`Unknown config key: ${key}`);
        continue;
      }
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      batch.update(validDocs[key], {
        value: serialized,
        updated_at: new Date().toISOString(),
      });
    }

    await batch.commit();

    if (errors.length > 0) {
      return res.status(400).json({ errors, updated: Object.keys(updates).length - errors.length });
    }

    // Return updated config
    const updatedSnapshot = await collections.config
      .where('user_id', '==', req.userId)
      .get();
    const config = {};
    for (const doc of updatedSnapshot.docs) {
      const data = doc.data();
      try {
        config[data.key] = JSON.parse(data.value);
      } catch {
        config[data.key] = data.value;
      }
    }
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// GET /api/config/sources — get available news sources organized by region
router.get('/sources', (req, res) => {
  res.json({
    germany: {
      tier1: ['bundesregierung.de', 'bundesbank.de', 'destatis.de'],
      tier2: ['handelsblatt.com', 'faz.net', 'spiegel.de', 'sueddeutsche.de', 'wiwo.de'],
      tier3: ['focus.de', 'tagesschau.de', 'zeit.de'],
    },
    japan: {
      tier1: ['kantei.go.jp', 'boj.or.jp', 'mof.go.jp'],
      tier2: ['nikkei.com', 'japantimes.co.jp', 'nhk.or.jp'],
    },
    us: {
      tier1: ['whitehouse.gov', 'federalreserve.gov', 'bls.gov'],
      tier2: ['reuters.com', 'bloomberg.com', 'ft.com'],
    },
    data: ['tradingeconomics.com'],
  });
});

module.exports = router;
