// Device routes
// GET  /api/device/status  — returns trial count and Pro status for this device
// POST /api/device/upgrade — marks device as Pro after a RevenueCat purchase

const express = require('express');
const router = express.Router();
const { getDeviceStatus, upgradeDeviceToPro, FREE_TRIAL_LIMIT } = require('../services/deviceService');
const { verifyProEntitlement } = require('../services/revenueCatService');

// GET /api/device/status
// Called on app launch so the UI can show "2 of 3 free articles used" or hide the paywall.
router.get('/status', async (req, res, next) => {
  try {
    const status = await getDeviceStatus(req.userId);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// POST /api/device/upgrade
// The iOS app calls this immediately after a successful RevenueCat purchase.
// Before marking is_pro = true, we verify the purchase server-side via the
// RevenueCat REST API. The app_user_id in RevenueCat is the same IDFV
// sent as X-User-ID, so we can verify directly.
router.post('/upgrade', async (req, res, next) => {
  try {
    const deviceId = req.userId;

    // Verify that RevenueCat confirms an active "pro" entitlement
    const verification = await verifyProEntitlement(deviceId);

    if (!verification.isActive) {
      return res.status(403).json({
        error: 'SUBSCRIPTION_NOT_VERIFIED',
        message: 'No active Pro subscription found. Please complete your purchase and try again.',
      });
    }

    await upgradeDeviceToPro(deviceId);

    const status = await getDeviceStatus(deviceId);
    res.json({
      upgraded: true,
      ...status,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
