// Invite codes (1.7)
// GET  /api/referral/code    — this device's invite code (for the share card)
// POST /api/referral/redeem  — { code } once, during setup, on a new device

const express = require('express');
const router = express.Router();
const { getOrCreateCode, redeem, REFERRAL_CAP } = require('../services/referralService');
const { getDeviceStatus } = require('../services/deviceService');

router.get('/code', async (req, res, next) => {
  try {
    res.json({ code: await getOrCreateCode(req.userId), cap: REFERRAL_CAP });
  } catch (err) { next(err); }
});

router.post('/redeem', async (req, res, next) => {
  try {
    const before = await getDeviceStatus(req.userId);
    const result = await redeem(req.userId, req.body && req.body.code, before.generation_count > 0);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ redeemed: true, ...(await getDeviceStatus(req.userId)) });
  } catch (err) { next(err); }
});

module.exports = router;
