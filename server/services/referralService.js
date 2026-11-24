// Invite codes ("referral") — version 1.7.
//
// Every device gets a short invite code. A NEW device can enter one code once,
// during setup. Then both devices get one extra free article. One inviter can
// earn at most REFERRAL_CAP extra articles this way.
//
// Data lives in its own collections; the devices collection is never written here:
//   referral_codes/{CODE}       → { device_id, created_at }
//   referral_credits/{deviceId} → { bonus, invited_by, invited_count, code, updated_at }
// The free-article limit is FREE_TRIAL_LIMIT + bonus (see deviceService).

const { firestore } = require('./firestore');

const codes = firestore.collection('referral_codes');
const credits = firestore.collection('referral_credits');

const REFERRAL_CAP = 10;
// No 0/O, 1/I/L — easy to read from a picture and type
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The rules, without the database (tested in test/referral.test.js).
 * Returns null when the code may be redeemed, otherwise the error key.
 */
function redeemError({ codeOwner, deviceId, alreadyRedeemed, deviceHasArticles, inviterCount }) {
  if (!codeOwner) return 'CODE_NOT_FOUND';
  if (codeOwner === deviceId) return 'OWN_CODE';
  if (alreadyRedeemed) return 'ALREADY_REDEEMED';
  // 2026-11-24: codes are asked when the free articles run out, so a device with articles may
  // redeem too. One code per device, ever (alreadyRedeemed) — the device ID survives reinstalls.
  if (inviterCount >= REFERRAL_CAP) return 'INVITER_CAP_REACHED';
  return null;
}

/** The device's own code; created on first call. */
async function getOrCreateCode(deviceId) {
  const mine = await credits.doc(deviceId).get();
  if (mine.exists && mine.data().code) return mine.data().code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const created = await firestore.runTransaction(async (t) => {
      const ref = codes.doc(code);
      if ((await t.get(ref)).exists) return false;
      t.set(ref, { device_id: deviceId, created_at: new Date().toISOString() });
      t.set(credits.doc(deviceId), { code, updated_at: new Date().toISOString() }, { merge: true });
      return true;
    });
    if (created) return code;
  }
  throw new Error('Could not create an invite code');
}

/** Extra free articles this device earned through invites. */
async function getBonus(deviceId) {
  const doc = await credits.doc(deviceId).get();
  return doc.exists ? (doc.data().bonus || 0) : 0;
}

/**
 * A new device enters a code. Both devices get +1 free article.
 * deviceHasArticles: the caller checks that this device has not generated yet.
 */
async function redeem(deviceId, rawCode, deviceHasArticles) {
  const code = normalizeCode(rawCode);
  return firestore.runTransaction(async (t) => {
    const codeDoc = await t.get(codes.doc(code || '-'));
    const codeOwner = codeDoc.exists ? codeDoc.data().device_id : null;
    const meRef = credits.doc(deviceId);
    const me = await t.get(meRef);
    const inviterRef = codeOwner ? credits.doc(codeOwner) : null;
    const inviter = inviterRef ? await t.get(inviterRef) : null;
    const inviterData = inviter && inviter.exists ? inviter.data() : {};

    const error = redeemError({
      codeOwner,
      deviceId,
      alreadyRedeemed: me.exists && !!me.data().invited_by,
      deviceHasArticles,
      inviterCount: inviterData.invited_count || 0,
    });
    if (error) return { ok: false, error };

    const now = new Date().toISOString();
    const meData = me.exists ? me.data() : {};
    t.set(meRef, { bonus: (meData.bonus || 0) + 1, invited_by: code, updated_at: now }, { merge: true });
    t.set(inviterRef, {
      bonus: (inviterData.bonus || 0) + 1,
      invited_count: (inviterData.invited_count || 0) + 1,
      updated_at: now,
    }, { merge: true });
    return { ok: true };
  });
}

module.exports = { REFERRAL_CAP, makeCode, normalizeCode, redeemError, getOrCreateCode, getBonus, redeem };
