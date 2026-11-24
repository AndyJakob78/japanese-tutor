const test = require('node:test');
const assert = require('node:assert');
// The rules only — no database needed
process.env.GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'test';
const { redeemError, normalizeCode, makeCode, REFERRAL_CAP } = require('../server/services/referralService');

const ok = { codeOwner: 'A', deviceId: 'B', alreadyRedeemed: false, deviceHasArticles: false, inviterCount: 0 };

test('a new device may redeem a friend\'s code', () => assert.equal(redeemError(ok), null));
test('unknown code', () => assert.equal(redeemError({ ...ok, codeOwner: null }), 'CODE_NOT_FOUND'));
test('own code', () => assert.equal(redeemError({ ...ok, codeOwner: 'B' }), 'OWN_CODE'));
test('only once per device', () => assert.equal(redeemError({ ...ok, alreadyRedeemed: true }), 'ALREADY_REDEEMED'));
test('a device that already read its free articles may redeem (code asked on the paywall)', () => assert.equal(redeemError({ ...ok, deviceHasArticles: true }), null));
test('inviter cap', () => {
  assert.equal(redeemError({ ...ok, inviterCount: REFERRAL_CAP - 1 }), null);
  assert.equal(redeemError({ ...ok, inviterCount: REFERRAL_CAP }), 'INVITER_CAP_REACHED');
});
test('codes are typed loosely', () => assert.equal(normalizeCode(' kt7-m2p '), 'KT7M2P'));
test('codes avoid look-alike characters', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^[A-HJKMNP-Z2-9]{6}$/);
});
