// Layer 2.5 — Wanakana-based romaji auto-fix
//
// Solves "Class A" romaji hallucinations: Claude correctly identifies the kana
// for a vocabulary word (e.g. クラウド) but emits wrong romaji (kumaudo instead
// of kuraudo). The kana is reliable; the romaji is hallucinated.
//
// Strategy:
//   1. For each vocab entry, check if word_romaji_macron matches the kana
//      (via wanakana round-trip).
//   2. If mismatch, regenerate romaji deterministically from the kana.
//   3. Apply Hepburn macron post-processing for long vowels (ou→ō, ii→ī, etc.).
//   4. Find-and-replace the bad romaji in title / summary / body too.
//
// Hepburn macron rule applied only when SAFE:
//   - word_kanji is pure kanji (Sino-Japanese compound) → apply
//   - word_kanji is pure katakana (loanword) → apply
//   - word_kanji has mixed kanji+hiragana (= okurigana = likely verb/adj) → skip
//     macronization because the trailing -u/-i is the verb ending, not a long vowel
//     (e.g. 思う おもう must stay "omou", not "omō")
//
// Logs every fix made so we have telemetry (saved alongside reviewer_fixes).

const wanakana = require('wanakana');

// Unicode ranges
const HIRAGANA  = /[぀-ゟ]/;
const KATAKANA  = /[゠-ヿ]/;
const KANJI     = /[一-鿿]/;

/**
 * Apply Hepburn long-vowel macronization to a romaji string that came out of
 * wanakana. Wanakana outputs "ou"/"oo"/"uu"/"aa"/"ee" where Hepburn uses
 * the macron form. "ii" and "ei" are kept as-is per Hepburn convention.
 */
function applyHepburnMacrons(romaji) {
  return romaji
    .replace(/ou/g, 'ō')
    .replace(/oo/g, 'ō')
    .replace(/uu/g, 'ū')
    .replace(/aa/g, 'ā')
    .replace(/ee/g, 'ē')
    .replace(/ii/g, 'ī');  // long i in katakana loanwords (ヒート → hīto)
}

/**
 * Decide whether macronization is safe for this word.
 *
 * Cases:
 * - Empty / pure-kana / pure-kanji / pure-katakana → SAFE
 * - Mixed kanji + hiragana → depends on what the hiragana is:
 *     • Inflection markers (な, だ, です, する, etc.) → SAFE
 *       The kanji portion is still Sino-Japanese; only the suffix is hiragana.
 *       Examples: 利用的な (riyō teki na), 必要だ (hitsuyō da), 利用する (riyō suru)
 *     • Verb/adjective okurigana (う, る, い, く, etc.) → UNSAFE
 *       The trailing hiragana is part of the WORD STEM. Macronizing the
 *       "ou" in 思う would wrongly produce "omō" instead of "omou".
 *       Examples: 思う (omou), 食べる (taberu), 大きい (ōkii — left as ookii)
 */
function safeToMacronize(wordKanji) {
  if (!wordKanji) return true;
  const hasKanji    = KANJI.test(wordKanji);
  const hasHiragana = HIRAGANA.test(wordKanji);
  // Pure cases (no mixing)
  if (!hasKanji) return true;        // pure-kana — safe
  if (!hasHiragana) return true;     // pure-kanji or pure-katakana — safe
  // Mixed kanji + hiragana — distinguish inflection from okurigana.
  // Allow macronization for non-verb inflection markers:
  //   ~な (na-adj), ~だ (copula), ~です (polite copula),
  //   ~する/~します/~しました (suru-verb), ~でした (polite past copula)
  if (/(?:な|だ|です|する|します|しました|でした|でしょう)$/.test(wordKanji)) {
    return true;
  }
  // Anything else: trailing hiragana is verb/adjective okurigana — block.
  return false;
}

/**
 * Convert kana to Hepburn romaji.
 * @param {string} kana - hiragana or katakana
 * @param {string} [kanjiForContext] - optional, used to decide macronization safety
 * @returns {string} Hepburn romaji with macrons where appropriate
 */
function kanaToHepburnRomaji(kana, kanjiForContext = '') {
  if (!kana) return '';
  const raw = wanakana.toRomaji(kana).toLowerCase();
  return safeToMacronize(kanjiForContext) ? applyHepburnMacrons(raw) : raw;
}

/**
 * Normalize a romaji string for COMPARISON — strips cosmetic separators
 * (hyphens, spaces) and canonicalizes double-vowel forms to macron form,
 * but KEEPS macron positions. So:
 *   "kengou"     and "kengō"     → match (different style, same sound)
 *   "jinkō-chīno" and "jinkōchinō" → DIFFER (macron on different syllables)
 *
 * The macron POSITION matters phonetically — `chīno` ≠ `chinō`.
 */
function normalizeForCompare(romaji) {
  return (romaji || '')
    .toLowerCase()
    .replace(/[-\s]/g, '')                 // strip hyphens, spaces (cosmetic)
    .replace(/[âîûêô]/g, c => ({ â:'ā', î:'ī', û:'ū', ê:'ē', ô:'ō' })[c]) // normalize accent style
    .replace(/ou/g, 'ō')                   // canonicalize double-vowel → macron
    .replace(/oo/g, 'ō')
    .replace(/uu/g, 'ū')
    .replace(/aa/g, 'ā')
    .replace(/ee/g, 'ē')
    .replace(/ii/g, 'ī');                  // long i from katakana ー
}

/**
 * Build a regex that finds a romaji word as a standalone token in body text.
 * Word-boundary aware via Unicode-letter lookaround.
 */
function buildWordReplaceRegex(word) {
  // Escape regex metacharacters in the search term
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<![a-zāīūēō])(${escaped})(?![a-zāīūēō])`,
    'gi'
  );
}

/**
 * Auto-fix hallucinated romaji throughout an article.
 *
 * For each entry in article.newWords + article.reviewWords:
 *   1. If word_kana is present, derive the "correct" Hepburn romaji from it.
 *   2. If word_romaji_macron normalizes to a different string than the derived
 *      romaji, this is a hallucination — fix the vocab entry AND find-replace
 *      every occurrence of the bad spelling in title / summary / body.
 *
 * Returns: { article (mutated), fixesMade: [{from, to, kana, kanji}] }
 */
function autoFixHallucinatedRomaji(article) {
  const fixesMade = [];

  const tryFixWord = (entry, label) => {
    if (!entry || !entry.word_kana || !entry.word_romaji_macron) return;
    // Skip entries where word_kanji contains Latin letters (abbreviations like
    // AI, GDPR, B2B). For these, the romaji should stay in its standard
    // alphabet form, NOT a phonetic transliteration of the kana spelling.
    // See KNOWLEDGE_HUB.md article #114 "AI/ēai flip-flop" case.
    if (entry.word_kanji && /[A-Za-z]/.test(entry.word_kanji)) return;
    const correct = kanaToHepburnRomaji(entry.word_kana, entry.word_kanji);
    if (!correct) return;
    const actualNorm   = normalizeForCompare(entry.word_romaji_macron);
    const correctNorm  = normalizeForCompare(correct);
    if (actualNorm === correctNorm) return; // already correct (modulo macron style)

    const from = entry.word_romaji_macron;
    const to   = correct;
    entry.word_romaji_macron = to;
    if (entry.word_romaji) {
      // ASCII variant (without macrons)
      entry.word_romaji = to
        .replace(/ā/g, 'a').replace(/ī/g, 'i').replace(/ū/g, 'u')
        .replace(/ē/g, 'e').replace(/ō/g, 'o');
    }
    fixesMade.push({ from, to, kana: entry.word_kana, kanji: entry.word_kanji || '', source: label });

    // Find-and-replace in title/summary/body (case-preserving for first letter)
    const re = buildWordReplaceRegex(from);
    const replacer = (match) => /^[A-Z]/.test(match)
      ? to.charAt(0).toUpperCase() + to.slice(1)
      : to;
    if (article.title_romaji)   article.title_romaji   = article.title_romaji.replace(re, replacer);
    if (article.summary_romaji) article.summary_romaji = article.summary_romaji.replace(re, replacer);
    if (article.body_romaji)    article.body_romaji    = article.body_romaji.replace(re, replacer);
  };

  for (const w of (article.newWords || []))    tryFixWord(w, 'new');
  for (const w of (article.reviewWords || [])) tryFixWord(w, 'review');

  return { article, fixesMade };
}

module.exports = {
  kanaToHepburnRomaji,
  autoFixHallucinatedRomaji,
  // exported for tests
  _internals: {
    applyHepburnMacrons,
    safeToMacronize,
    normalizeForCompare,
  },
};
