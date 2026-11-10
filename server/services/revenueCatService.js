// RevenueCat server-side verification service
// Uses the RevenueCat REST API to verify a subscriber's "pro" entitlement
// before upgrading them in Firestore.
//
// Docs: https://www.revenuecat.com/docs/api-v1#tag/customers/operation/subscribers
//
// Requires REVENUECAT_SECRET_KEY in .env (starts with sk_).
// If the key is missing, logs a warning and allows upgrade anyway (local dev only).

const REVENUECAT_BASE = 'https://api.revenuecat.com/v1';

/**
 * Verify that the given app user has an active "pro" entitlement in RevenueCat.
 *
 * @param {string} appUserId  — The RevenueCat app_user_id (same as IDFV / X-User-ID)
 * @returns {{ isActive: boolean, expiresDate: string|null, productId: string|null }}
 */
async function verifyProEntitlement(appUserId) {
  const secretKey = process.env.REVENUECAT_SECRET_KEY;

  // ── Dev fallback: no key configured → allow upgrade with a warning ──
  if (!secretKey) {
    console.warn(
      '[revenueCatService] REVENUECAT_SECRET_KEY not set — skipping verification (dev mode).'
    );
    return { isActive: true, expiresDate: null, productId: null };
  }

  const url = `${REVENUECAT_BASE}/subscribers/${encodeURIComponent(appUserId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `RevenueCat API error ${res.status}: ${body}`
    );
  }

  const data = await res.json();

  // data.subscriber.entitlements.<name> holds per-entitlement info
  const proEntitlement = data.subscriber?.entitlements?.pro;

  if (!proEntitlement) {
    return { isActive: false, expiresDate: null, productId: null };
  }

  return {
    isActive:    proEntitlement.expires_date
                   ? new Date(proEntitlement.expires_date) > new Date()
                   : true,   // lifetime / no-expiry products
    expiresDate: proEntitlement.expires_date || null,
    productId:   proEntitlement.product_identifier || null,
  };
}

module.exports = { verifyProEntitlement };
