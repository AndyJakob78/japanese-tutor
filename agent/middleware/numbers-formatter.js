// Deterministic currency / large-number formatter.
//
// THE PROBLEM (article #148): Claude (and the Haiku reviewer) cannot reliably
// convert English money amounts into Japanese magnitude words. A "$2.6 billion"
// valuation came out as "yonhyaku-gojū doru" (450 dollars) — off by a factor of
// ~5.8 million, teaching the learner a flat-out wrong fact.
//
// Japanese groups large numbers by powers of 10,000: 万 (10^4), 億 (10^8),
// 兆 (10^12). English groups by 10^3 (thousand/million/billion/trillion). The
// mismatch is exactly where LLMs fumble. So we do the math deterministically in
// code and hand Claude a "cheat sheet" of pre-computed correct forms — it never
// has to compute, only copy.

// English magnitude → numeric multiplier
const MAGNITUDES = {
  trillion: 1e12,
  billion: 1e9,
  million: 1e6,
  thousand: 1e3,
};

// Currency token → Japanese rendering (katakana loanword or kanji)
const CURRENCIES = {
  '$': 'ドル', usd: 'ドル', dollar: 'ドル', dollars: 'ドル',
  '€': 'ユーロ', eur: 'ユーロ', euro: 'ユーロ', euros: 'ユーロ',
  '¥': '円', jpy: '円', yen: '円',
  '£': 'ポンド', gbp: 'ポンド', pound: 'ポンド', pounds: 'ポンド',
};

/**
 * Decompose an integer into a Japanese magnitude string using 兆/億/万.
 *   2_600_000_000       → "26億"
 *   2_635_000_000       → "26億3500万"
 *   11_730_000_000_000  → "11兆7300億"
 *   500_000             → "50万"
 *   4200                → "4200"
 * Returns a digit+kanji string (e.g. "26億"). Small numbers (<10000) stay plain.
 */
function toJapaneseMagnitude(nRaw) {
  let n = Math.round(nRaw);
  if (n === 0) return '0';
  const neg = n < 0;
  n = Math.abs(n);

  const cho = Math.floor(n / 1e12); n %= 1e12;
  const oku = Math.floor(n / 1e8);  n %= 1e8;
  const man = Math.floor(n / 1e4);  n %= 1e4;
  const rest = n;

  let out = '';
  if (cho) out += `${cho}兆`;
  if (oku) out += `${oku}億`;
  if (man) out += `${man}万`;
  if (rest) out += `${rest}`;
  return (neg ? '-' : '') + out;
}

/**
 * Parse a single English amount phrase into a numeric value + currency token.
 * Returns { value, currency } or null if no currency-amount found.
 * Handles: "$2.6 billion", "2.6 billion dollars", "€1 billion", "¥11.73 trillion",
 *          "$500 million", "£3.5 million", "26.35 billion euros".
 */
function parseAmount(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();

  // symbol-prefixed: $2.6 billion / €1 billion / ¥11.73 trillion
  let m = s.match(/([$€¥£])\s*([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|thousand)?/);
  if (m) {
    const num = parseFloat(m[2].replace(/,/g, ''));
    const mag = m[3] ? MAGNITUDES[m[3]] : 1;
    return { value: num * mag, currency: CURRENCIES[m[1]] };
  }

  // number + magnitude + currency word: "2.6 billion dollars", "500 million euros"
  m = s.match(/([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|thousand)\s*(dollars?|euros?|yen|pounds?|usd|eur|jpy|gbp)/);
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    const mag = MAGNITUDES[m[2]];
    return { value: num * mag, currency: CURRENCIES[m[3]] };
  }

  // currency word + magnitude without explicit symbol is ambiguous; skip.
  return null;
}

/**
 * Format a parsed amount as a Japanese string: "26億ドル", "50万ユーロ", "1兆円".
 */
function formatAmount(value, currency) {
  return `${toJapaneseMagnitude(value)}${currency}`;
}

/**
 * Scan the news data (numbers + keyFacts + headlines + topic) for currency
 * amounts and build a de-duplicated cheat sheet mapping the English phrase to
 * the correct Japanese form.
 *
 * @returns {Array<{english: string, japanese: string}>}
 */
function extractAmounts(newsData) {
  const seen = new Set();
  const results = [];
  const strings = [];

  strings.push(newsData?.topic || '');
  for (const a of (newsData?.articles || [])) {
    strings.push(a.headline || '');
    for (const f of (a.keyFacts || [])) strings.push(f);
    for (const nstr of (a.numbers || [])) strings.push(nstr);
    for (const q of (a.quotes || [])) strings.push(q);
  }

  // Find all currency-amount substrings in each string.
  const AMOUNT_RE = /([$€¥£]\s*[\d,]+(?:\.\d+)?\s*(?:trillion|billion|million|thousand)?)|([\d,]+(?:\.\d+)?\s*(?:trillion|billion|million|thousand)\s*(?:dollars?|euros?|yen|pounds?))/gi;
  for (const str of strings) {
    if (!str) continue;
    const matches = str.match(AMOUNT_RE);
    if (!matches) continue;
    for (const raw of matches) {
      const parsed = parseAmount(raw);
      if (!parsed || !parsed.currency || !isFinite(parsed.value) || parsed.value < 1000) continue;
      const english = raw.trim().replace(/\s+/g, ' ');
      const japanese = formatAmount(parsed.value, parsed.currency);
      const key = japanese; // dedupe by target form
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ english, japanese });
    }
  }
  return results;
}

/**
 * Build a prompt-injectable cheat sheet string. Empty string if no amounts.
 */
function buildNumberCheatSheet(newsData) {
  const amounts = extractAmounts(newsData);
  if (amounts.length === 0) return '';
  const rows = amounts.map(a => `- "${a.english}" → **${a.japanese}** (use this EXACT form)`).join('\n');
  return `## 💴 PRE-COMPUTED CURRENCY AMOUNTS — copy these, do NOT do your own math

The source mentions these money amounts. Japanese groups large numbers by 万/億/兆, NOT by the English thousand/million/billion — so DO NOT try to translate the number yourself. Use the exact Japanese form below:

${rows}

Reminder: 億 = 100 million, 兆 = 1 trillion. "$2.6 billion" is 26億ドル (twenty-six oku), NOT "450 doru" or "ni-ten-roku billion".`;
}

module.exports = {
  buildNumberCheatSheet,
  extractAmounts,
  // exported for tests
  _internals: { toJapaneseMagnitude, parseAmount, formatAmount },
};
