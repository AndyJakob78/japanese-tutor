// Device trial management service
// Tracks per-device trial usage and Pro subscription status in Firestore.
//
// Trial logic:
//   - Each device gets 3 free article generations.
//   - Once count >= FREE_TRIAL_LIMIT the /generate route returns 403 TRIAL_EXHAUSTED.
//   - Upgrading to Pro (is_pro: true) bypasses all limits.
//   - generation_count is incremented ONLY after a successful Claude pipeline call,
//     so a failed generation never costs the user a trial slot.

const { firestore, collections } = require('./firestore');

const FREE_TRIAL_LIMIT = 3;

// ── Read-only status check ────────────────────────────────────────────────────
// Called at the top of /generate before the pipeline runs.
// Does NOT write to Firestore — increment is a separate step after success.

async function checkTrialStatus(deviceId) {
  const doc = await collections.devices.doc(deviceId).get();

  if (!doc.exists) {
    // First-ever request from this device — allow it (doc created on first increment)
    return { allowed: true, isPro: false, generationCount: 0 };
  }

  const data = doc.data();
  const isPro    = data.is_pro === true;
  const count    = data.generation_count || 0;

  if (isPro) {
    return { allowed: true, isPro: true, generationCount: count };
  }

  if (count >= FREE_TRIAL_LIMIT) {
    return { allowed: false, isPro: false, generationCount: count };
  }

  return { allowed: true, isPro: false, generationCount: count };
}

// ── Post-success increment ────────────────────────────────────────────────────
// Called only after runPipeline() resolves successfully.
// Creates the device document if it doesn't exist yet (first-time users).

async function incrementGenerationCount(deviceId) {
  const deviceRef = collections.devices.doc(deviceId);

  await firestore.runTransaction(async (t) => {
    const doc = await t.get(deviceRef);

    if (!doc.exists) {
      t.set(deviceRef, {
        device_id:        deviceId,
        generation_count: 1,
        is_pro:           false,
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      });
    } else {
      // Re-read is_pro inside the transaction: if the user upgraded to Pro
      // between checkTrialStatus() and incrementGenerationCount(), skip the
      // increment so their count stays clean. (No-op for them either way since
      // Pro users bypass the limit, but it keeps the data tidy.)
      if (doc.data().is_pro === true) return;

      t.update(deviceRef, {
        generation_count: (doc.data().generation_count || 0) + 1,
        updated_at:       new Date().toISOString(),
      });
    }
  });
}

// ── Pro upgrade ───────────────────────────────────────────────────────────────
// Called from POST /api/device/upgrade after the iOS app completes a RevenueCat purchase.
// Uses merge:true so it works whether or not the device doc already exists.

async function upgradeDeviceToPro(deviceId) {
  await collections.devices.doc(deviceId).set({
    device_id:    deviceId,
    is_pro:       true,
    upgraded_at:  new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }, { merge: true });
}

// ── Status for iOS app ────────────────────────────────────────────────────────
// Used by GET /api/device/status so the app can show "2 of 3 free articles used".

async function getDeviceStatus(deviceId) {
  const doc = await collections.devices.doc(deviceId).get();

  if (!doc.exists) {
    return {
      device_id:        deviceId,
      generation_count: 0,
      is_pro:           false,
      trials_remaining: FREE_TRIAL_LIMIT,
    };
  }

  const data  = doc.data();
  const isPro = data.is_pro === true;
  const count = data.generation_count || 0;

  return {
    device_id:        deviceId,
    generation_count: count,
    is_pro:           isPro,
    trials_remaining: isPro ? null : Math.max(0, FREE_TRIAL_LIMIT - count),
  };
}

module.exports = {
  checkTrialStatus,
  incrementGenerationCount,
  upgradeDeviceToPro,
  getDeviceStatus,
  FREE_TRIAL_LIMIT,
};
