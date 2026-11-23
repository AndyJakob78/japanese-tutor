// Where learners come from (1.7) — one record per device, written once at the end of setup.
// POST /api/attribution { phone_language, time_zone, where_heard, places, topics, steps_skipped, ads_token }
// The Apple Ads token (AdServices) is exchanged for campaign / keyword ids here,
// after the answer is sent, so setup never waits for Apple.

const express = require('express');
const router = express.Router();
const { firestore } = require('../services/firestore');

const attribution = firestore.collection('attribution');
const clip = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const list = (v) => (Array.isArray(v) ? v.slice(0, 12).map(x => clip(x)).filter(Boolean) : undefined);

async function lookupAppleAds(token) {
  const res = await fetch('https://api-adservices.apple.com/api/v1/', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: token,
  });
  if (!res.ok) return { status: res.status };
  const d = await res.json();
  // Only ids — no personal data comes back from Apple
  return { attribution: d.attribution === true, campaign_id: d.campaignId, ad_group_id: d.adGroupId, keyword_id: d.keywordId, country: d.countryOrRegion };
}

router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const record = {
      phone_language: clip(b.phone_language, 20),
      time_zone: clip(b.time_zone, 60),
      where_heard: clip(b.where_heard, 40),
      places: list(b.places),
      topics: list(b.topics),
      steps_skipped: list(b.steps_skipped),
      app_version: clip(b.app_version, 20),
      learning_language: req.learningLanguage || 'ja',
      created_at: new Date().toISOString(),
    };
    Object.keys(record).forEach(k => record[k] === undefined && delete record[k]);
    const ref = attribution.doc(req.userId);
    await ref.set(record, { merge: true });
    res.json({ saved: true });

    if (typeof b.ads_token === 'string' && b.ads_token.length > 10) {
      lookupAppleAds(b.ads_token)
        .then(ads => ref.set({ apple_ads: ads }, { merge: true }))
        .catch(err => console.log(`[attribution] Apple Ads lookup failed: ${err.message}`));
    }
  } catch (err) { next(err); }
});

module.exports = router;
