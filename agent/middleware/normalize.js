// Romaji text normalization middleware.
//
// Conservative, regex-based fixes for high-confidence error patterns Claude
// occasionally produces when writing Hepburn romaji. Runs as a pre-validation
// pass on `body_romaji` so QA checks see the cleaned-up text.
//
// Scope (intentionally narrow — see CLAUDE.md "don't add features beyond what
// the task requires"):
//   §0  Known Claude romaji hallucinations (e.g. kumaudo → kuraudo).
//       This is a growing whitelist — see KNOWLEDGE_HUB.md "Known Hallucinations"
//       for the catalogue of confirmed bugs and how to add new ones.
//   §2  Compound-verb + passive/causative suffix attachment
//   §3  Suru-verb passive correction (`Xrareru` → `X sareru` for known nouns)
//   §4  Devoiced copulas (`des`/`mas` → `desu`/`masu`)
//   §6  Numeric normalization (1–99 spelled-out → digits, with counter)
//
// NOT included (low-confidence, high false-positive risk):
//   §1  Phonetic consonant shifts — Claude doesn't make these
//   §3  `iu imasu` → `itte imasu` — would over-correct legitimate phrasing
//   §4  `bakkari` → `bakari` — Claude writes formal news, unlikely
//   §5  Homophone disambiguation — handled in kanji-mode generation prompt
//   §6  `kyaku` → `kokyaku` — semantic substitution, too aggressive

// ---------- §0: Known Claude romaji hallucinations ----------
//
// Each entry: [wrong, correct]. We apply word-boundary-aware case-insensitive
// replacement and preserve the original capitalization (first letter caps in
// the source → first letter caps in the replacement).
//
// CRITERIA for adding an entry:
// - The "wrong" spelling is NEVER a valid Japanese word in any context.
// - We've confirmed Claude actually produced this spelling (don't speculate).
// - The "correct" form is unambiguous (no homophone resolution needed).
//
// When adding entries, also note them in KNOWLEDGE_HUB.md "Known Hallucinations"
// with the date and the article ID where the bug appeared.
const KNOWN_HALLUCINATIONS = [
  // 2026-05-24, article #98 (user 238EB8CA): "kumaudo" used as romaji for クラウド
  // (cloud — IT context). Vocab entry had word_kana="クラウド" but word_romaji_macron="kumaudo".
  ['kumaudo', 'kuraudo'],

  // 2026-05-24, article #99 (user 238EB8CA): "nī-ko" used for the counter "2 items".
  // Japanese number counters (ni, san, yon) NEVER elongate to nī/sān/yōn.
  // Safe to fix unconditionally because nī-ko is never valid Japanese.
  ['nī-ko', 'ni-ko'],
  ['nīko',  'niko'],   // without hyphen, just in case
  ['sān-ko', 'san-ko'],
  ['yōn-ko', 'yon-ko'],

  // 2026-05-24, article #101 (user 238EB8CA): "jinkō-chīno" used for 人工知能 (AI).
  // Correct Hepburn is jinkō-chinō (both kanji read with long ō, not ī).
  // `chīno` is not a valid Japanese word in any context — it's a misplaced
  // long-vowel mark. Safe to fix unconditionally.
  ['chīno',         'chinō'],
  ['jinkō-chīno',   'jinkō-chinō'],
  ['jinkō chīno',   'jinkō chinō'],
  // Also catch the no-macron-at-all variant some models output
  ['jinkou-chinou', 'jinkō-chinō'],
  ['jinkou chinou', 'jinkō chinō'],
  // And the half-baked variant — long on the first but not second
  ['jinkō-chino',   'jinkō-chinō'],

  // 2026-05-24, article #101: "seikou" used for 成功 (success).
  // Hepburn requires macron: seikō. `seikou` is a common Claude slip on this
  // specific high-frequency word. Safe because "seikou" is NEVER a valid
  // standalone Japanese romaji word (no morpheme boundary breaks the long-o here).
  ['seikou', 'seikō'],

  // 2026-06-06, article #110: "atarasii" used for 新しい (new, atarashii).
  // Missing the "sh" digraph. `atarasii` is never valid Japanese romaji.
  ['atarasii', 'atarashii'],
  ['atarasiku', 'atarashiku'],
  ['atarasikatta', 'atarashikatta'],

  // 2026-06-06, article #113: "hiyūmanoido" used for ヒューマノイド (humanoid).
  // The correct katakana sound is ヒュー (hyū), not ヒユー (hiyū). Both vocab
  // and body cases observed. Safe to fix unconditionally.
  ['hiyūmanoido',  'hyūmanoido'],
  ['hiyūmanoidō',  'hyūmanoido'],   // also strips erroneous trailing macron
  ['hiyūman',      'hyūman'],
  ['Hiyūmanoido',  'Hyūmanoido'],
  ['Hiyūmanoidō',  'Hyūmanoido'],
  ['Hiyūman',      'Hyūman'],

  // 2026-06-06, article #115: "purapashī" used for プライバシー (privacy).
  // Wrong: pu-ra-pa-shī. Correct: pu-ra-i-ba-shī. Claude swapped the middle
  // syllables. Safe to fix — "purapashī" is never valid Japanese romaji.
  ['purapashī',  'puraibashī'],
  ['Purapashī',  'Puraibashī'],
  ['purapasi',   'puraibashi'],   // also catches the no-macron/no-sh variant
  ['Purapasi',   'Puraibashi'],

  // 2026-06-06, article #115: "zeimucho" used for 税務署 (tax office, zeimusho).
  // The kanji 署 is read しょ (sho), not ちょ (cho). Specific to this Sino-
  // compound — DO NOT generalize cho→sho because cho IS valid for 帳, 庁, etc.
  ['zeimucho',  'zeimusho'],
  ['Zeimucho',  'Zeimusho'],

  // 2026-06-06, article #117: "zeimusha" used for 税務署 (tax office, zeimusho).
  // Another wrong reading of 署. Same compound, different mis-reading
  // (sha instead of sho). Specific to this Sino-compound — sha IS valid in
  // 者 (person), 社 (company), 車 (vehicle), so DO NOT generalize.
  ['zeimusha',  'zeimusho'],
  ['Zeimusha',  'Zeimusho'],

  // 2026-10-18, article #188 (user 238EB8CA): wrong te-forms of godan -ru
  // verbs (減る heru, 困る komaru) conjugated as if they were ichidan.
  // Correct te-form is -tte. Neither wrong form is a Japanese word.
  ['herete',   'hette'],
  ['komarete', 'komatte'],
  // 2026-10-18, article #185 + quiz #1283: te-form of the u-verb 使う
  // written "tsukaite" (must be tsukatte). Same class: 思う, 洗う, 習う, 歌う.
  // None of the wrong forms is a Japanese word.
  ['tsukaite', 'tsukatte'],
  ['omoite',   'omotte'],
  ['araite',   'aratte'],
  ['naraite',  'naratte'],
  ['utaite',   'utatte'],
  // Article #188: typo for 合併 (merger).
  ['gappai',   'gappei'],

  // NOT adding: kumo → kuraudo, mimikaki → iyahon, kyūshoku → kyūsoku,
  // sekkai → sekai, wakatsu → wakeru, niju-ko → nijū-shurui, mondai → moderu,
  // jiken → dekigoto, akuishishon → baishū. These are all legitimate Japanese
  // words used in the WRONG context (or context-dependent style choices).
  // Replacing them unconditionally would break articles where the original IS
  // appropriate. The quality-reviewer.js pass handles these via prompt.
];

// Native counter for things (一つ…九つ). 2026-10-18, article #188: 三つ was
// romanized "san-tsu" (and glued: "san-tsuno"), 一つ as "hito-tsu". The
// native series is hitotsu, futatsu, mittsu, yottsu, itsutsu, muttsu,
// nanatsu, yattsu, kokonotsu — "san-tsu"/"yon-tsu" are never valid.
const NATIVE_COUNTER = {
  'hito': 'hitotsu', 'ichi': 'hitotsu',
  'futa': 'futatsu', 'ni': 'futatsu',
  'mit': 'mittsu', 'mi': 'mittsu', 'san': 'mittsu',
  'yot': 'yottsu', 'yon': 'yottsu',
  'itsu': 'itsutsu', 'go': 'itsutsu',
  'mut': 'muttsu', 'roku': 'muttsu',
  'nana': 'nanatsu', 'shichi': 'nanatsu',
  'yat': 'yattsu', 'hachi': 'yattsu',
  'kokono': 'kokonotsu', 'kyū': 'kokonotsu',
};

/**
 * Fix mis-romanized native counters: "san-tsu" → "mittsu",
 * "hito-tsu" → "hitotsu", and split a glued "no" ("san-tsuno" → "mittsu no").
 * Only hyphenated forms are touched (unhyphenated hitotsu etc. are already
 * correct, and e.g. "nitsu…" could be part of "nitsuite").
 */
function fixNativeCounters(text) {
  if (!text) return text;
  const stems = Object.keys(NATIVE_COUNTER).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(?<![a-zāīūēō])(${stems})-tsu(no)?(?![a-zāīūēō])`, 'gi');
  return text.replace(re, (match, stem, no) => {
    let fixed = NATIVE_COUNTER[stem.toLowerCase()];
    if (/^[A-Z]/.test(match)) fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    return no ? `${fixed} no` : fixed;
  });
}

/**
 * Split the conditional/quotative particle と glued onto a plain verb before
 * a comma: "naruto," → "naru to,". 2026-10-18, article #188: "hitotsu ni
 * naruto, …" made the learner misread it as one word. Lowercase only, so the
 * place/name "Naruto" stays untouched; the comma requirement keeps it to the
 * clause-final conditional.
 */
function fixGluedConditionalTo(text) {
  if (!text) return text;
  return text.replace(
    /(?<![A-Za-zāīūēōĀĪŪĒŌ])(naru|suru|aru|iru|kuru|iku|miru|kiku|iu|osu|nai)to,/g,
    '$1 to,'
  );
}

/**
 * Replace known-bad spellings with their correct counterparts.
 * Case-preserving for the first letter (Kumaudo → Kuraudo, kumaudo → kuraudo).
 * Operates on standalone tokens only (won't touch substrings of larger words).
 */
/**
 * Drop a reading glued to a word that needs none. The model sometimes adds
 * furigana to Latin or katakana words, and the converter romanizes it:
 * "AI(ēai)" (#197), "Shisutemu(shisutemu)", "Meta(Meta)" (#168).
 */
function stripRedundantReadings(text) {
  return text.replace(/([A-Za-zāīūēōĀĪŪĒŌ]+)[(（]([A-Za-zāīūēōĀĪŪĒŌ-]+)[)）]/g, (match, word, reading) => {
    if (word.toLowerCase() === reading.toLowerCase()) return word;
    return /^[A-Z]{2,}$/.test(word) && reading === reading.toLowerCase() ? word : match;
  });
}

function fixKnownHallucinations(text) {
  if (!text) return text;
  let out = text;
  for (const [wrong, correct] of KNOWN_HALLUCINATIONS) {
    const re = new RegExp(
      `(?<![a-zāīūēō])(${wrong})(?![a-zāīūēō])`,
      'gi'
    );
    out = out.replace(re, (match) => {
      // Preserve first-letter capitalization from the source.
      return /^[A-Z]/.test(match)
        ? correct.charAt(0).toUpperCase() + correct.slice(1)
        : correct;
    });
  }
  return out;
}

/**
 * Normalize a single vocabulary word (token, not sentence).
 * Currently applies the hallucinations map. Kept separate from normalizeBody
 * because word-level fields shouldn't get sentence-level treatments
 * (verb-suffix attachment, numeric normalization, etc.) that assume context.
 */
function normalizeWord(text) {
  if (!text) return text;
  return fixKnownHallucinations(text);
}

// ---------- §2: Verb-suffix attachment ----------

// Polite passive/causative/potential suffixes that must stay attached to their
// verb stem. Limited to *polite* forms because the bare dictionary forms
// (`reru`, `rareru`) can ambiguously appear in non-suffix contexts.
const POLITE_SUFFIXES = [
  'remasu', 'remashita', 'remasen', 'remashō',
  'raremasu', 'raremashita', 'raremasen', 'raremashō',
  'saremasu', 'saremashita', 'saremasen', 'saremashō',
];

// Compound verbs commonly produced as two tokens by generative models.
// Whitelist approach: only join when the exact pair is found.
const COMPOUND_VERBS = [
  ['hiki', 'ukeru'],   // 引き受ける — take on / accept
  ['hiki', 'dasu'],    // 引き出す — draw out
  ['tori', 'atsukau'], // 取り扱う — handle
  ['tori', 'ireru'],   // 取り入れる — adopt
  ['tachi', 'ageru'],  // 立ち上げる — launch
  ['tachi', 'mukau'],  // 立ち向かう — confront
  ['mochi', 'komu'],   // 持ち込む — bring in
  ['mochi', 'iru'],    // 用いる — use
  ['furi', 'kaeru'],   // 振り返る — look back
  ['uke', 'tsugu'],    // 受け継ぐ — inherit
  ['kaki', 'naosu'],   // 書き直す — rewrite
  ['yobi', 'kakeru'],  // 呼びかける — call out
  ['mōshi', 'komu'],   // 申し込む — apply
  ['toki', 'akasu'],   // 解き明かす — unravel
];

/**
 * Attach the te-form to passive/potential/causative verb stems when the
 * tokenizer has incorrectly split them with a space.
 *
 *   "tsukaware te imasu" → "tsukawarete imasu"   (passive te-form + iru-aux)
 *   "tabe rare te kudasai" — out of scope (we don't join across two spaces)
 *
 * Why limited to passive/causative stems: the bare te-form (`te`) is too
 * common to safely join after ANY verb stem — `kare te` could be a phrase.
 * But after `-rare`, `-sare`, `-are`, `-ase` (which only appear as suffixes,
 * never standalone), the following `te` is unambiguously the te-form.
 *
 * NOT joined: subsequent `imasu` / `iru` / `kudasai` — these are separate
 * auxiliary verbs that legitimately stand alone after the te-form.
 */
function attachTeFormToPassiveStem(text) {
  // Two patterns, applied in sequence:
  //
  // (1) LONG STEMS — verb-stems ≥ 2 chars before passive/causative marker:
  //     "tsukaw|are te" → "tsukawarete", "iw|are te" → "iwarete", "kow|are te" → "kowarete"
  //     The {2,} requirement avoids false positives on short pronouns/nouns
  //     (kare/dare/mare all end in "are" but are not verb stems).
  //
  // (2) SHORT SURU-AUX STEMS — exactly `sare` and `sase` (1-char prefix):
  //     "sare te" → "sarete" (passive of suru),
  //     "sase te" → "sasete" (causative of suru)
  //     We allow only these two because they're guaranteed unambiguous suru-aux
  //     forms; other 4-letter "-are"/"-ase" words are pronouns or unrelated nouns.
  //
  // Lookahead on trailing `te` ensures we don't truncate `tesuto` etc.
  const longRe  = /([a-zāīūēō]{2,}(?:rare|sare|are|ase)) te(?![a-zāīūēō])/gi;
  const shortRe = /(?<![a-zāīūēō])(sare|sase) te(?![a-zāīūēō])/gi;
  return text.replace(longRe, '$1te').replace(shortRe, '$1te');
}

/**
 * Split te-form + auxiliary (iru/imasu/ita/etc.) into separate tokens.
 * Hepburn convention writes them as separate words; Claude sometimes joins
 * them as a single token, which makes the iOS reader/tokenizer treat them
 * as one word.
 *
 *   "shiteimasu"      → "shite imasu"
 *   "motarashiteimasu" → "motarashite imasu"
 *   "tabeteiru"       → "tabete iru"
 *
 * Pattern: word ending in `te` (preceded by at least one letter) directly
 * followed by `imasu`/`iru`/`ita`/`inai`/etc. Lookahead ensures we're at a
 * word boundary (so we don't split mid-substring of an unrelated word).
 */
function splitTeFormAux(text) {
  return text.replace(
    /([a-zāīūēō]+te)(imasu|imashita|imasen|imashō|iru|ita|inai)(?=[^a-zāīūēō]|$)/gi,
    '$1 $2'
  );
}

/**
 * Attach `masu`/`mashita`/`masen`/`mashō` to a passive stem that's already
 * ended in `re`/`rare`/`sare`/`are`/`ase`/`sase`. Handles the case where
 * the script converter left a stray space in `okonaware masu` etc.
 *
 *   "okonaware masu"     → "okonawaremasu"
 *   "tsukaware mashita"  → "tsukawaremashita"
 *   "torikawasare masen" → "torikawasaremasen"
 *
 * Requires 2+ chars BEFORE the passive marker to avoid false positives on
 * short pronouns/nouns (kare, dare, etc. ending in "are").
 */
function attachMasuToPassiveStem(text) {
  const re = /([a-zāīūēō]{2,}(?:rare|sare|are|ase|sase)) (masu|mashita|masen|mashō)(?![a-zāīūēō])/gi;
  return text.replace(re, '$1$2');
}

/**
 * Attach polite passive/potential/causative suffixes to the preceding verb
 * stem when a model has erroneously inserted a space.
 *
 *   "hiraka remashita" → "hirakaremashita"
 *   "tabe raremasu"    → "taberaremasu"
 */
function attachPoliteSuffixes(text) {
  // Stem char class includes ascii a-z and Hepburn macron vowels.
  const stemChars = '[a-zāīūēō]';
  const suffixGroup = POLITE_SUFFIXES.join('|');
  // Use lookbehind/lookahead so we don't consume word boundaries that might
  // be part of markers like [NEW].
  const re = new RegExp(
    `(${stemChars}{2,}) +(${suffixGroup})(?=[^a-zāīūēō]|$)`,
    'gi'
  );
  return text.replace(re, '$1$2');
}

/**
 * Build a regex matching one compound verb pair, accommodating inflection.
 *
 * Ichidan verbs (ending -eru / -iru) get a stem-prefix match so we catch
 * inflected forms like `tachi ageta`, `hiki ukemasu`. We require stem length
 * ≥ 2 to avoid greedy matches on tiny stems (e.g. `iru`'s stem `i` would
 * otherwise eat `iruka` "dolphin"). Godan + short-stem cases fall back to
 * exact-form matching — narrower but safe.
 */
function makeCompoundVerbRegex(a, b) {
  let pattern;
  if (/[ei]ru$/.test(b)) {
    const stem = b.slice(0, -2);
    pattern = stem.length >= 2
      ? `${a} (${stem}[a-zāīūēō]+)`
      : `${a} (${b})`;
  } else {
    pattern = `${a} (${b})`;
  }
  return new RegExp(`(?<![a-zāīūēō])${pattern}(?![a-zāīūēō])`, 'gi');
}

/**
 * Join known split compound verbs.
 */
function joinCompoundVerbs(text) {
  let out = text;
  for (const [a, b] of COMPOUND_VERBS) {
    const re = makeCompoundVerbRegex(a, b);
    out = out.replace(re, (_m, captured) => `${a}${captured}`);
  }
  return out;
}

// ---------- §3: Suru-verb passive correction ----------

// Common Sino-Japanese nouns that take する. When followed directly by
// `rareru` (e.g. `seiseirareru`), the correct form is `<noun> sareru`.
// Hand-curated to avoid false positives — only include nouns that are
// unambiguous Sino-Japanese suru-verb roots.
const SURU_VERB_NOUNS = [
  'seisei',    // 生成 — generation
  'kentō',     // 検討 — examination
  'riyō',      // 利用 — use / utilization
  'katsuyō',   // 活用 — application
  'seizō',     // 製造 — manufacture
  'unyō',      // 運用 — operation
  'kakunin',   // 確認 — confirmation
  'chōsa',     // 調査 — investigation
  'bunseki',   // 分析 — analysis
  'tōroku',    // 登録 — registration
  'sakusei',   // 作成 — creation
  'happyō',    // 発表 — announcement
  'kettei',    // 決定 — decision
  'kaisai',    // 開催 — holding (an event)
  'sankā',     // 参加 — participation (uncommon spelling, sankā/sanka)
  'sanka',     // 参加 — participation
  'jisshi',    // 実施 — implementation
  'donyū',     // 導入 — introduction
  'dōnyū',     // 導入 — introduction (macron variant)
  'kaihatsu',  // 開発 — development
  'kaizen',    // 改善 — improvement
  'teikyō',    // 提供 — offering
  'shiyō',     // 使用 — use
  'sōsa',      // 操作 — operation
];

/**
 * Fix `<noun>rareru` / `<noun>raremashita` etc. to `<noun> sareru` etc.
 * for known suru-verb noun roots.
 */
function fixSuruVerbPassive(text) {
  let out = text;
  for (const noun of SURU_VERB_NOUNS) {
    // Match: noun directly followed by rare-form (no intervening space).
    // Capture the inflection suffix so we can preserve tense.
    const re = new RegExp(
      `(?<![a-zāīūēō])${noun}rare(ru|masu|mashita|masen|nai|nakatta)(?![a-zāīūēō])`,
      'gi'
    );
    out = out.replace(re, (_m, infl) => {
      // `rareru` (potential/passive) on a suru-noun should be `sareru`
      // (passive of suru) — drop the `rare` and substitute `sare`.
      return `${noun} sare${infl}`;
    });
  }
  return out;
}

// ---------- §4: Devoiced copulas ----------

/**
 * Fix the missing "sh" digraph — common Claude slip where `sh` is written as
 * `s`. Two specific patterns where this is unambiguous:
 *   1. `~site` (te-form of verbs like 押す/出す/動かす) → `~shite`
 *      e.g. "ugokasite imashita" → "ugokashite imashita"
 *   2. `~sii` (i-adjective form like 新しい/美味しい/詳しい) → `~shii`
 *      e.g. "atarasii kaisha" → "atarashii kaisha"
 *
 * Both patterns require a preceding vowel — that's the morphological signal
 * that the `si`/`sh` is the digraph and not e.g. an unrelated English fragment.
 * Result: never touches English words that happen to contain "site" or "sii".
 */
function fixMissingShDigraph(text) {
  // In Hepburn, し is ALWAYS "shi" — bare "si" is never a valid Japanese
  // syllable. Catch the "si" typo on the common verb/adjective conjugation
  // tails. (article #148: the reviewer typed "emasita" for "emashita".)
  const TAILS = 'masita|masen|masu|masho|tai|ta|te|i';
  // (a) word-initial "si" verb forms (after space or start) — LOWERCASE ONLY,
  //     so we never touch capitalized Latin proper nouns (Silicon, Siemens).
  //     Runs FIRST so "simasita" → "shimasita" → then (b) fixes the 2nd si.
  let out = text.replace(
    new RegExp(`(^|[^A-Za-zāīūēō])si(${TAILS})(?![a-zāīūēō])`, 'g'),
    (_m, pre, tail) => `${pre}shi${tail}`
  );
  // (b) "si" preceded by a VOWEL (attached conjugations) — case-insensitive.
  //     emasita→emashita, tsukurimasita→tsukurimashita, oisii→oishii,
  //     and the 2nd "si" of a "simasita"→"shimasita"→"shimashita" chain.
  out = out.replace(
    new RegExp(`([aiueoāīūēō])si(${TAILS})(?![a-zāīūēō])`, 'gi'),
    (_m, v, tail) => `${v}shi${tail}`
  );
  return out;
}

/**
 * `des` → `desu`, `mas` → `masu` when used as a sentence-ending suffix.
 *
 * We DO NOT use a lookbehind because `mas` is almost always attached directly
 * to a verb stem ending in `i` (e.g. `ikimas`), so requiring a non-letter
 * before it would miss the common case. The trailing negative lookahead is
 * the real guard: it ensures we don't truncate already-correct forms
 * (`desu`, `desho`, `deshita`, `masu`, `mashita`, `masen`) or word-internal
 * substrings (`description` → `desc` followed by `c`, a letter, blocks).
 */
function normalizeDevoicedCopulas(text) {
  return text
    .replace(/des(?![a-zāīūēōh])/gi, 'desu')
    .replace(/mas(?![a-zāīūēō])/gi, 'masu');
}

// ---------- §6: Numeric normalization ----------

// Hepburn romaji digit names with macron variants.
const DIGIT_WORDS = {
  ichi: 1, ni: 2, san: 3, yon: 4, shi: 4, go: 5,
  roku: 6, nana: 7, shichi: 7, hachi: 8, kyū: 9, ku: 9,
};

// Counter suffixes we'll convert. Keep narrow — these are unambiguous.
const COUNTER_SUFFIXES = [
  'nichi',  // 日 — days
  'nin',    // 人 — people
  'kai',    // 回 — times / 階 — floors
  'nen',    // 年 — years
  'gatsu',  // 月 — months
  'en',     // 円 — yen
  'ji',     // 時 — hours / o'clock
  'fun',    // 分 — minutes
  'pun',    // 分 — minutes (rendaku variant)
  // Added 2026-06-06 for tech/news article number formatting
  'senchi',     // センチ / 糎 — centimeters
  'mētoru',     // メートル — meters
  'kiroguramu', // キログラム — kilograms
  'kiro',       // キロ — kilo (kg or km, context-dependent)
  'guramu',     // グラム — grams
  'riitoru',    // リットル — liters
  'tonna',      // トン — tons
  'kagetsu',    // 箇月 / ヶ月 — months (duration, distinct from gatsu = calendar month)
  'shūkan',     // 週間 — weeks (duration)
  'jikan',      // 時間 — hours (duration, distinct from ji = o'clock)
];

/**
 * Parse a spelled-out number 1–999 (e.g. `gojū`, `jūni`, `nijūsan`, `hyaku-rokujū-go`).
 * Returns the integer or null if not parseable. Hyphens within the input are stripped.
 */
function parseSpelledNumber(s) {
  const lower = s.toLowerCase().replace(/-/g, '');
  if (DIGIT_WORDS[lower] !== undefined) return DIGIT_WORDS[lower];
  if (lower === 'jū')    return 10;
  if (lower === 'hyaku') return 100;
  // CHECK HUNDREDS FIRST — the literal "hyaku" is more specific than the
  // generic tens pattern, which would otherwise greedily match (e.g. "hyakuroku"
  // as the tens digit, which is meaningless).
  // Hundreds: optional prefix-digit + 'hyaku' + optional rest-1-99
  // e.g. 'hyaku' = 100, 'hyakugo' = 105, 'nihyakujūsan' = 213, 'hyakurokujūgo' = 165
  const hundreds = lower.match(/^([a-zāīūēō]*)hyaku([a-zāīūēō]*)$/);
  if (hundreds) {
    let hundredsDigit = 1;
    if (hundreds[1]) {
      const d = DIGIT_WORDS[hundreds[1]];
      if (d === undefined || d < 2) return null;
      hundredsDigit = d;
    }
    if (!hundreds[2]) return hundredsDigit * 100;
    const rest = parseSpelledNumber(hundreds[2]);
    if (rest === null) return null;
    return hundredsDigit * 100 + rest;
  }
  // jū + 1–9  →  11–19
  const teen = lower.match(/^jū([a-zāīūēō]+)$/);
  if (teen && DIGIT_WORDS[teen[1]] !== undefined) {
    return 10 + DIGIT_WORDS[teen[1]];
  }
  // N + jū (+ M)  →  20–99
  const tens = lower.match(/^([a-zāīūēō]+)jū([a-zāīūēō]*)$/);
  if (tens) {
    const tensDigit = DIGIT_WORDS[tens[1]];
    if (tensDigit === undefined || tensDigit < 2) return null;
    if (!tens[2]) return tensDigit * 10;
    const onesDigit = DIGIT_WORDS[tens[2]];
    if (onesDigit === undefined) return null;
    return tensDigit * 10 + onesDigit;
  }
  return null;
}

// Map romaji counter suffix → kanji counter (for kanji writing mode).
const COUNTER_KANJI = {
  nichi: '日', nin: '人', kai: '回', nen: '年', gatsu: '月',
  en: '円', ji: '時', fun: '分', pun: '分',
  senchi: 'cm', mētoru: 'm', kiroguramu: 'kg', kiro: 'キロ',
  guramu: 'g', riitoru: 'L', tonna: 't',
  kagetsu: 'ヶ月', shūkan: '週間', jikan: '時間',
};

/**
 * Convert spelled-out number + counter to digits + counter.
 *   romaji mode:  `gojūni-nichi` → `52-nichi`
 *   kanji  mode:  `gojūni-nichi` → `52日`
 *   kana   mode:  left unchanged (keeps phonetic spelling natural in kana)
 */
function normalizeNumbers(text, writingSystem) {
  if (writingSystem === 'kana') return text;
  const counterGroup = COUNTER_SUFFIXES.join('|');
  // Allow hyphens within the number word (e.g. "hyaku-rokujū-go") AND allow
  // a space OR hyphen between the number and the counter ("60 kiroguramu").
  const re = new RegExp(
    `(?<![a-zāīūēō0-9])([a-zāīūēō][a-zāīūēō-]*?)[\\s-]?(${counterGroup})(?![a-zāīūēō])`,
    'gi'
  );
  return text.replace(re, (match, numWord, counter) => {
    // A lone "shi" is 4 only in shigatsu (April); with every other counter 4
    // is yo-/yon-. Otherwise real words break: shiji 支持 → "4-ji" (#164),
    // shien 支援 → "4-en" (#152).
    if (numWord.toLowerCase() === 'shi' && counter.toLowerCase() !== 'gatsu') return match;
    const n = parseSpelledNumber(numWord);
    if (n === null || n < 1 || n > 999) return match;
    if (writingSystem === 'kanji') {
      return `${n}${COUNTER_KANJI[counter.toLowerCase()] || counter}`;
    }
    return `${n}-${counter}`;
  });
}

// Native day readings: 2nd–10th, 14th, 20th, 24th.
const DAY_READINGS = 'futsuka|mikka|yokka|itsuka|muika|nanoka|yōka|kokonoka|tōka|hatsuka|jūyokka|nijūyokka';

/**
 * A digit followed by the full spelled-out reading says the number twice:
 * `6muika`, `13jūsannichi`, `2futari` (#203). Keep the digit and the counter
 * only — `6ka`, `13nichi` — or, for tsuitachi / hitori / futari, the word
 * without the digit. script-converter.js prevents this for kanji-first
 * articles; this catches what the reviewer or a direct romaji pass writes.
 */
function fixDigitWithReading(text) {
  return text
    .replace(new RegExp(`\\b(\\d+)[\\s-]?(${DAY_READINGS})(?![a-zāīūēō])`, 'gi'), '$1ka')
    .replace(/\b\d+[\s-]?(tsuitachi|hitori|futari)(?![a-zāīūēō])/gi, '$1')
    .replace(/\b(\d+)([a-zāīūēō]+?)(nichi|gatsu|nen|ji|kai|fun|pun|en|nin)(?![a-zāīūēō])/gi,
      (match, digits, numWord, counter) =>
        parseSpelledNumber(numWord) === Number(digits) ? `${digits}${counter}` : match);
}

// ---------- Entry point ----------

/**
 * Apply all conservative normalization rules to the article body.
 * Idempotent — safe to call multiple times.
 *
 * @param {string} text - Article body text (romaji, kana, or kanji mode).
 * @param {string} [writingSystem] - 'romaji' | 'kana' | 'kanji'.
 * @returns {string}
 */
function normalizeBody(text, writingSystem = 'romaji') {
  if (!text) return text;
  let out = text;

  // Known-hallucination fixes apply across all writing systems — bad romaji
  // can leak into the body in any mode (especially loanwords in kana mode
  // where the romaji might be inline).
  out = fixKnownHallucinations(out);
  out = fixNativeCounters(out);

  // Verb-suffix attachment fixes apply to romaji output only — they target
  // tokenization slips in romaji spelling.
  if (writingSystem === 'romaji') {
    out = stripRedundantReadings(out);
    out = attachTeFormToPassiveStem(out);
    out = attachMasuToPassiveStem(out);
    out = attachPoliteSuffixes(out);
    out = joinCompoundVerbs(out);
    out = fixSuruVerbPassive(out);
    out = normalizeDevoicedCopulas(out);
    out = fixMissingShDigraph(out);
    out = splitTeFormAux(out);
    out = fixGluedConditionalTo(out);
  }

  if (writingSystem === 'romaji') out = fixDigitWithReading(out);

  // Numeric normalization runs for romaji + kanji (skipped for kana).
  out = normalizeNumbers(out, writingSystem);

  // Collapse any double spaces introduced by edits.
  out = out.replace(/ {2,}/g, ' ');

  return out;
}

module.exports = {
  normalizeBody,
  normalizeWord,
  // exported for unit testing
  _internals: {
    attachTeFormToPassiveStem,
    attachMasuToPassiveStem,
    attachPoliteSuffixes,
    joinCompoundVerbs,
    fixSuruVerbPassive,
    normalizeDevoicedCopulas,
    fixMissingShDigraph,
    splitTeFormAux,
    normalizeNumbers,
    parseSpelledNumber,
    fixKnownHallucinations,
    fixNativeCounters,
    fixGluedConditionalTo,
    stripRedundantReadings,
    fixDigitWithReading,
    KNOWN_HALLUCINATIONS,
  },
};
