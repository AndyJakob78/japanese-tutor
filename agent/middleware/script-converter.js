// Script Converter — Deterministic conversion from kanji+furigana to romaji or kana.
//
// ARCHITECTURE NOTE (Option A from KNOWLEDGE_HUB):
// Instead of asking Claude to write romaji directly (which hallucinates), we
// always have Claude write in kanji+furigana format (its strongest mode), then
// deterministically convert to the user's preferred writing system here.
//
// This eliminates Class A romaji hallucinations entirely — the kanji+furigana
// has the kana embedded next to each kanji, so we extract the truth directly.
//
// Input format (per skills/kanji-standards/SKILL.md):
//   "首相（しゅしょう）は 新（あたら）しい 経済（けいざい）政策（せいさく）を 発表（はっぴょう）しました。"
//
// Outputs:
//   romaji: "shushō wa atarashii keizai seisaku wo happyō shimashita."
//   kana:   "しゅしょうは あたらしい けいざいせいさくを はっぴょうしました。"
//   kanji:  (unchanged — already in that format)

const wanakana = require('wanakana');

// Unicode ranges
const KANJI_AND_REPEAT = /[一-鿿々]+/;

// Katakana for foreign sounds that wanakana spells wrong (2026-11-11, #211
// "vyira"): ヴィ→vyi, ヴァ→vua, ティ→tei, ディ→dei, ファ→fua, フィ→fyi,
// ウィ→ui… Hepburn writes va/vi/ti/di/fa/fi/wi. Replaced with romaji before
// wanakana runs (it passes ASCII through); a following ー becomes a macron.
const FOREIGN_SOUNDS = {
  'ヴァ': 'va', 'ヴィ': 'vi', 'ヴェ': 've', 'ヴォ': 'vo', 'ヴュ': 'vyu', 'ヴ': 'vu',
  'ウィ': 'wi', 'ウェ': 'we', 'ウォ': 'wo',
  'ティ': 'ti', 'ディ': 'di', 'トゥ': 'tu', 'ドゥ': 'du', 'テュ': 'tyu', 'デュ': 'dyu',
  'ファ': 'fa', 'フィ': 'fi', 'フェ': 'fe', 'フォ': 'fo', 'フュ': 'fyu',
  'ツァ': 'tsa', 'ツィ': 'tsi', 'ツェ': 'tse', 'ツォ': 'tso',
  'クァ': 'kwa', 'グァ': 'gwa', 'イェ': 'ye', 'シェ': 'she', 'ジェ': 'je', 'チェ': 'che',
};
const MACRON = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };
const FOREIGN_RE = new RegExp(`(${Object.keys(FOREIGN_SOUNDS).sort((a, b) => b.length - a.length).join('|')})(ー?)`, 'g');

/**
 * Replace foreign-sound katakana with Hepburn romaji (ヴィラ → "viラ", パーティー → "パーtī"),
 * then every remaining katakana + ー with its romaji and a macron (ニー → "nī";
 * wanakana writes "nii", so ディズニーランド came out "dizuniirando").
 */
function romanizeForeignSounds(text) {
  return String(text || '')
    .replace(FOREIGN_RE, (m, kana, long) => {
      const r = FOREIGN_SOUNDS[kana];
      return long ? r.slice(0, -1) + MACRON[r.slice(-1)] : r;
    })
    .replace(/([ァ-ヺ][ァィゥェォャュョ]?)ー/g, (m, kana) => {
      const r = wanakana.toRomaji(kana);
      const v = r.slice(-1);
      return MACRON[v] ? r.slice(0, -1) + MACRON[v] : m;
    });
}

/**
 * Apply Hepburn long-vowel macronization to a romaji string from wanakana.
 * Wanakana outputs "ou"/"oo"/"uu"/"aa"/"ee" where Hepburn uses macron form.
 * Same logic as wanakana-fix.js — kept here to avoid coupling.
 */
/**
 * Capitalize the first letter of the string and the first letter after each
 * sentence-ending punctuation (. ! ?). Standard Hepburn convention.
 *
 * Does NOT touch already-capitalized letters (e.g. Latin abbreviations like
 * AI, GDPR, SAP — these stay as Claude wrote them).
 */
function capitalizeSentences(text) {
  if (!text) return text;
  let out = text;
  // First letter of the string
  out = out.replace(/^(\s*)([a-zāīūēō])/, (_m, ws, ch) => ws + ch.toUpperCase());
  // First letter after sentence-ending punctuation + optional space/markers
  out = out.replace(/([.!?]\s+(?:\[(?:NEW|REVIEW)\]\s+)?)([a-zāīūēō])/g,
    (_m, prefix, ch) => prefix + ch.toUpperCase()
  );
  return out;
}

function applyHepburnMacrons(romaji) {
  // NOTE: we deliberately do NOT macronize `ii` here. In hiragana, "ii" is
  // almost always two separate i sounds (e.g. i-adjectives like 大きい ōkii,
  // 美味しい oishii). In katakana, ヒート would ideally become "hīto" but
  // wanakana gives "hiito" — accepting "hiito" is the safer tradeoff than
  // over-macronizing every adjective ending.
  //
  // Words with a capital letter are Latin brand names or abbreviations that
  // wanakana passed through (MacBook, Google, YouTube) — leave them alone,
  // otherwise MacBook → "MacBōk" (#203). Romaji from wanakana is still
  // all lowercase here; sentence capitalisation runs later.
  return romaji.replace(/[A-Za-zāīūēō]+/g, word => /[A-Z]/.test(word) ? word : word
    .replace(/ou/g, 'ō')
    .replace(/oo/g, 'ō')
    .replace(/uu/g, 'ū')
    .replace(/aa/g, 'ā')
    .replace(/ee/g, 'ē'));
}

// Counter kanji whose furigana Claude sometimes writes as the FULL reading
// after a digit: 6日（むいか） → "6muika", 13日（じゅうさんにち） → "13jūsannichi".
// The digit already says the number, so keep only the counter part of the
// reading — "6ka", "13nichi" — like 5つ → "5tsu" elsewhere in the app.
const DIGIT_COUNTER_SUFFIXES = {
  '日': ['にち', 'か'],
  '月': ['がつ'],
  '年': ['ねん'],
  '時': ['じ'],
  '回': ['かい'],
  '分': ['ふん', 'ぷん'],
  '円': ['えん'],
  '人': ['にん'],
};

function fixDigitCounterReadings(text) {
  return text.replace(/(\d+)([日月年時回分円人])（([぀-ゟ]+)）/g, (match, digits, counter, reading) => {
    // ついたち (1st), ひとり / ふたり (1–2 people): the reading has no
    // counter part to keep, so drop the digit and use the word itself.
    if (['ついたち', 'ひとり', 'ふたり'].includes(reading)) return `${counter}（${reading}）`;
    const suffix = DIGIT_COUNTER_SUFFIXES[counter].find(s => reading.endsWith(s) && reading !== s);
    return suffix ? `${digits}${counter}（${suffix}）` : match;
  });
}

/**
 * Convert kanji+furigana text to romaji.
 *   "首相（しゅしょう）は 新（あたら）しい 政策" → "shushō wa atarashii seisaku"
 *
 * Steps:
 *   1. For each kanji+furigana pair `<kanji>+（<kana>+）`, strip the kanji
 *      and keep only the furigana kana. This gives us a "kana-only" form.
 *   2. Convert all remaining kana (incl. okurigana, particles, loanwords) to
 *      romaji via wanakana.
 *   3. Apply Hepburn macron rules for long vowels.
 *   4. Normalize spacing around [NEW]/[REVIEW] markers so the iOS tokeniser
 *      can split them as standalone tokens.
 *   5. Collapse multiple spaces.
 *
 * Preserves: [NEW]/[REVIEW] markers, ASCII chars (digits, brand names,
 * abbreviations like AI/GDPR), punctuation.
 */
/**
 * Convert full-width Latin letters and digits to standard half-width.
 * Claude occasionally outputs full-width chars in kanji+furigana mode
 * (e.g. Ｃ Ｅ Ｓ ２ ０ ２ ６ instead of CES 2026). These survive through
 * wanakana unchanged and surface in the body as visual oddities.
 *
 * IMPORTANT: only converts the Latin-letter and digit ranges. Full-width
 * punctuation (（ ） ？ ！ ・ etc.) is intentionally preserved — those are
 * standard Japanese typography that should stay, and the kanji+furigana
 * parser needs the full-width parens to find furigana groups.
 */
function fullwidthToHalfwidth(text) {
  if (!text) return text;
  return text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );
}

function convertKanjiFuriganaToRomaji(text) {
  if (!text) return text;
  let out = fixDigitCounterReadings(fullwidthToHalfwidth(text));

  // Step 0: Pre-split for readability — insert spaces in places where the
  // kanji+furigana source has no space but romaji conventions want one.
  //
  // (a) Adjacent kanji+furigana pairs: 経済（けいざい）政策（せいさく）
  //     → 経済（けいざい） 政策（せいさく)  →  "keizai seisaku"
  // Also: 会社（かいしゃ）SAP → "kaisha SAP" (split before Latin too).
  // Also: 十億（じゅうおく）ユーロ → "jūoku yūro" (split before katakana too).
  out = out.replace(/）([一-鿿々A-Za-z゠-ヿ])/g, '） $1');
  // (b) Suru-verb / -sare / -sase conjugations after a kanji+furigana noun:
  //     発表（はっぴょう）しました → 発表（はっぴょう） しました → "happyō shimashita"
  //     Match し+(ま|て|よ|な|え) (covers shimasu, shite, shiyō, shinai, shiete)
  //     and す+(る) (dictionary form), さ+(れ|せ) (passive/causative).
  //     EXCLUDES adjective endings like 新（あたら）しい (matches し but next char is い → no split).
  out = out.replace(/）(し[まてよなえ])/g, '） $1');
  out = out.replace(/）(する)/g, '） $1');
  out = out.replace(/）(さ[れせ])/g, '） $1');
  // (c) Particles after a kanji+furigana noun:
  //     首相（しゅしょう）は → 首相（しゅしょう） は → "shushō wa" (after は→わ)
  //     経済（けいざい）の → 経済（けいざい） の → "keizai no"
  //     政策（せいさく）を → 政策（せいさく） を → "seisaku wo"
  //     Single-char particles: はがをにでとものへやかねなよさ
  //     Multi-char starters covered by single-char first letter: か(ら)/ま(で)/よ(り)/な(ど)/だ(け)
  //   Ambiguous starters are restricted so okurigana isn't split
  //   (2026-10-18): ま only as まで (来（き）ます stays "kimasu"), な not before
  //   い/く/か/け/さ (少（すく）ない stays "sukunai"), か only as から or a
  //   sentence-final question か (短（みじか）かった stays joined), and さ is
  //   gone entirely (小（ちい）さい was coming out "chii sai").
  //   が is not split before ら/り/る/れ/ろ/っ: that is the okurigana of -garu
  //   verbs (上（あ）がらない stays "agaranai", not "a garanai" — 2026-11-10, #205).
  out = out.replace(/）([はをにでとものへやねよだ]|が(?![らりるれろっ])|まで|など|な(?![いくかけさ])|か(?=ら|[\s。、！？]|$))/g, '） $1');

  // (d) Boundary between katakana/hiragana and Latin letters (both directions).
  //     スタートアップAleph → スタートアップ Aleph → "sutātoappu Aleph"
  //     Wi-Fiです → Wi-Fi です
  //     This handles loanwords adjacent to brand names AND Latin abbreviations
  //     adjacent to copulas/verbs in hiragana.
  out = out.replace(/([゠-ヿ぀-ゟ])([A-Za-z])/g, '$1 $2');
  out = out.replace(/([A-Za-z])([゠-ヿ぀-ゟ])/g, '$1 $2');

  // (e) Hiragana particle directly glued to a katakana run (loanword + particle):
  //     スタートアップを → スタートアップ を → "sutātoappu wo"
  //     ロボットや       → ロボット や       → "robotto ya"
  //   This is SAFE without a trailing-whitespace lookahead because katakana
  //   loanwords never take these hiragana as okurigana — a hiragana particle
  //   char (は が を に で と も の へ や) right after katakana is virtually
  //   always a grammatical particle, not part of the word. (Colloquial
  //   katakana verbs like サボる/ググる end in る, which is not in this list.)
  //   Note: the listing particle や is hiragana (U+3084); katakana words that
  //   END in the ya sound use katakana ヤ (U+30E4), so タイヤ ("tire") is not
  //   affected.
  out = out.replace(/([゠-ヿ])([はがをにでとものへや])/g, '$1 $2');

  // (e2) Particle immediately before a furigana'd kanji word (no space).
  //     ロボットや機械（きかい） → ...や 機械（きかい） → "... ya kikai"
  //   A hiragana particle directly followed by a kanji that opens a furigana
  //   group （ is a strong word-boundary signal — the kanji begins a new word.
  //   Restricted to the unambiguous object/listing/topic particles so we don't
  //   mis-split okurigana (e.g. しい技術 — い is not in this list, stays joined).
  out = out.replace(/([はがをにでとものへや])([一-鿿々]+（)/g, '$1 $2');

  // (e3) Script boundaries are word boundaries (2026-11-11, #211):
  //     ・ between katakana words → space (プリンス・ホテル → "purinsu hoteru")
  //     hiragana → katakana: 新（あたら）しいヴィラ → "atarashii vira", はプリンス → "wa purinsu"
  //     katakana → kanji:    リゾート軽井沢（ → "rizōto karuizawa"
  //     katakana → hiragana: スタートします → "sutāto shimasu" (ー stays with its katakana)
  out = out.replace(/・/g, ' ');
  out = out.replace(/([ぁ-ゖ])([ァ-ヺ])/g, '$1 $2');
  out = out.replace(/([ァ-ヺー])([一-鿿々])/g, '$1 $2');
  out = out.replace(/([ァ-ヺー])([ぁ-ゖ])/g, '$1 $2');

  // (e4) ような / ように are "yō na" / "yō ni" (#211 "ie no yōna heya", #203):
  //     の+よう splits, よう+な/に splits, and a space follows before the next word.
  out = out.replace(/のよう(?=[なに])/g, 'の よう');
  out = out.replace(/([き）])なよう(?=[なに])/g, '$1 な よう');   // 好（す）きなように → "suki na yō ni"
  out = out.replace(/よう([なに])(?=[ぁ-ゖァ-ヺ一-鿿々])/g, 'よう $1 ');
  out = out.replace(/よう([なに])(?![ぁ-ゖ])/g, 'よう $1');

  // (f) Particle after a LONG hiragana run (3+ chars to avoid false positives
  //     on 2-char words like なに, おに, あに). Catches cases like:
  //     ありがとう を → covered, ところに → covered.
  //     これは, それは (2-char demonstratives) — Claude usually writes a space
  //     here anyway per the kanji-mode skill; we accept the false negative.
  out = out.replace(/([぀-ゟ]{3,})([はがをにでとものへ])(?=[\s。、！？]|$)/g, '$1 $2');

  // Step 1: Strip kanji, keep only the furigana kana.
  out = out.replace(/[一-鿿々]+（([぀-ゟ゠-ヿー]+)）/g, '$1');

  // Step 1.5: Particle pre-process. wanakana converts は→ha, へ→he, which are
  // wrong for the TOPIC and DIRECTION particles (which are pronounced wa, e).
  // Detect particle position: は/へ at the END of a kana run (followed by
  // whitespace, punctuation, or end-of-string). Replace with わ/え which
  // wanakana correctly converts to wa/e.
  out = out.replace(/は(?=[\s。、！？]|$)/g, 'わ');
  out = out.replace(/へ(?=[\s。、！？]|$)/g, 'え');

  // Step 2: Convert remaining kana to romaji. wanakana preserves ASCII,
  // markers like [NEW], digits, and punctuation as-is. Foreign sounds first
  // (wanakana spells ヴィ "vyi", ティ "tei" …).
  out = wanakana.toRomaji(romanizeForeignSounds(out));

  // Step 3: Hepburn macronization (long vowels).
  out = applyHepburnMacrons(out);

  // Step 4: Ensure [NEW]/[REVIEW] markers have spaces around them so the
  // iOS whitespace-tokeniser highlights ONLY the next word, not the whole
  // surrounding text run.
  out = out.replace(/([^\s])(\[(?:NEW|REVIEW)\])/g, '$1 $2');
  out = out.replace(/(\[(?:NEW|REVIEW)\])([^\s])/g, '$1 $2');

  // Step 5: Collapse multiple spaces.
  out = out.replace(/ {2,}/g, ' ');

  // Step 6: Sentence-initial capitalization (Hepburn convention).
  out = capitalizeSentences(out);

  return out;
}

/**
 * Convert kanji+furigana text to plain kana (hiragana/katakana only).
 *   "首相（しゅしょう）は 新（あたら）しい" → "しゅしょうは あたらしい"
 *
 * Same as romaji conversion but stops after stripping the kanji.
 */
function convertKanjiFuriganaToKana(text) {
  if (!text) return text;
  let out = fullwidthToHalfwidth(text);
  out = out.replace(/[一-鿿々]+（([぀-ゟ゠-ヿー]+)）/g, '$1');
  // Ensure marker spacing for iOS tokeniser
  out = out.replace(/([^\s])(\[(?:NEW|REVIEW)\])/g, '$1 $2');
  out = out.replace(/(\[(?:NEW|REVIEW)\])([^\s])/g, '$1 $2');
  out = out.replace(/ {2,}/g, ' ');
  return out;
}

/**
 * Split romaji sentences that exceed maxLen words at natural clause boundaries.
 *
 * This replaces the old (futile) "retry with a different topic when sentences
 * are too long" logic — changing the topic never shortened Claude's sentences,
 * it just tripled the pipeline time and caused app timeouts. Splitting in-place
 * is deterministic, instant, and actually fixes the problem.
 *
 * Strategy: for each sentence over the limit, find the best clause boundary
 * nearest the middle and convert it to a sentence break. Preferred boundaries,
 * in priority order:
 *   1. A comma ", "  → replace with ". " (capitalize next word)
 *   2. A te-form + space ("...te ")  → "...te. " (mid-clause continuation)
 *   3. A conjunction particle boundary (" ga ", " kara ", " node ", " shi ")
 * We only split ONCE per pass per sentence (recurse if still too long), and
 * never split if it would leave a fragment shorter than 3 words.
 *
 * @param {string} text - romaji body (already converted + spaced)
 * @param {number} maxLen - max words per sentence (config.max_sentence_length)
 */
function splitLongSentences(text, maxLen) {
  if (!text || !maxLen || maxLen < 4) return text;

  const sentences = text.split(/(?<=[.!?])\s+/);
  const out = [];

  const splitOne = (sentence, depth = 0) => {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxLen || depth > 4) return [sentence];

    // Candidate split points (word index AFTER which to break), with priority.
    // We ONLY use clean, unambiguous boundaries to avoid dangling connectors:
    //   1. Comma — Japanese 読点 maps to ", " and is a true clause boundary.
    //   2. te-form (word ending in -te) — clauses chain on the te-form, so a
    //      break there is grammatical (slightly informal but readable).
    // We deliberately do NOT split on conjunction particles like "ga"/"kara":
    //   "ga" collides with the subject marker (koto GA dekiru), and "kara"/
    //   "node" leave a dangling "because" at the end of the first sentence.
    const mid = Math.floor(words.length / 2);
    const candidates = [];
    for (let i = 2; i < words.length - 3; i++) {
      const w = words[i];
      if (/,$/.test(w)) candidates.push({ i, pri: 1 });            // comma
      else if (/te$/i.test(w)) candidates.push({ i, pri: 2 });     // te-form
    }
    if (candidates.length === 0) return [sentence]; // no safe split point

    // Pick the highest-priority candidate closest to the middle.
    candidates.sort((a, b) => (a.pri - b.pri) || (Math.abs(a.i - mid) - Math.abs(b.i - mid)));
    const splitAt = candidates[0].i;

    const first = words.slice(0, splitAt + 1).join(' ').replace(/,$/, '') + '.';
    let secondWords = words.slice(splitAt + 1);
    // Capitalize the first word of the new sentence.
    if (secondWords.length) {
      secondWords[0] = secondWords[0].charAt(0).toUpperCase() + secondWords[0].slice(1);
    }
    const second = secondWords.join(' ');

    // Recurse on each half in case they're still too long.
    return [...splitOne(first, depth + 1), ...splitOne(second, depth + 1)];
  };

  for (const s of sentences) {
    if (!s.trim()) continue;
    out.push(...splitOne(s));
  }
  return out.join(' ');
}

/**
 * Top-level dispatcher: convert kanji+furigana to the target writing system.
 * Returns the input unchanged if target is 'kanji'.
 */
// Standalone hiragana tokens that legitimately follow a kanji word with a
// space: particles, copulas, auxiliaries that are their own token, suru-verb
// forms, and common adverbs/conjunctions. Anything else right after "）" is
// okurigana that belongs to the kanji word.
const STANDALONE_HIRAGANA = new Set([
  // particles
  'は','が','を','に','へ','で','と','や','か','も','の','から','まで','より',
  'など','だけ','しか','ね','よ','な','には','とは','にも','でも','では','へは',
  'ので','のに','けど','けれど','ても','という','として','について','かも',
  'くらい','ぐらい','ほど','ずつ','ごろ','ころ','ばかり','まま','ため','こと',
  'もの','とき','ところ','よう','そう','らしい','みたい','わけ','はず',
  // copula / existence / suru
  // (no いる/ある forms: right after a kanji word they are okurigana —
  //  思（おも）います, 書（か）いて — a noun never takes them without a particle)
  'だ','です','でした','でしょう','だった','じゃ','する','します','しました',
  'しません','して','した','しない','される','されます','されました','なる',
  'なります','なりました','なって','できる','できます','できました','ください',
  // adverbs / conjunctions / demonstratives
  'とても','もう','まだ','すぐ','もっと','ずっと','きっと','よく','たくさん',
  'みんな','いつも','また','そして','しかし','でも','だから','つまり','ちょっと',
  'この','その','あの','どの','これ','それ','あれ','どう','なに','ぜひ','まず',
  'ほとんど','やはり','たとえば','おわり','おわりに','はじめ','あと','まえ',
]);

/**
 * Re-join okurigana that was split from its kanji by a space:
 *   "大（おお） きい" → "大（おお）きい",  "来（き） ます" → "来（き）ます",
 *   "建（た） てて" → "建（た）てて",       "一（ひと） つ目（め）" → "一（ひと）つ目（め）".
 * Sonnet 5.5 (2026-10-18) put a space after EVERY "）", which produced split
 * romaji ("ō kii", "tsuka tte", "e tte"). Particles/copulas/adverbs that are
 * their own word (STANDALONE_HIRAGANA) keep their space. A glued trailing
 * particle on "く" ("多（おお） くの") becomes "多（おお）く の".
 */
function joinSplitOkurigana(text) {
  if (!text) return text;
  return text.replace(/）[ \u3000]+([ぁ-ゖー]+)/g, (match, run, offset, whole) => {
    const bare = run.replace(/[。、！？!?,.]+$/, '');
    if (STANDALONE_HIRAGANA.has(bare)) return match;
    const kuParticle = bare.match(/^(く|しく)(の|に|は|も|を)$/);
    if (kuParticle) return `）${kuParticle[1]} ${kuParticle[2]}`;
    return `）${run}`;
  });
}

function convertScript(text, targetWritingSystem) {
  if (!text) return text;
  text = joinSplitOkurigana(text);
  switch (targetWritingSystem) {
    case 'romaji': return convertKanjiFuriganaToRomaji(text);
    case 'kana':   return convertKanjiFuriganaToKana(text);
    case 'kanji':  return text;
    default:       return text;
  }
}

module.exports = {
  convertScript,
  convertKanjiFuriganaToRomaji,
  convertKanjiFuriganaToKana,
  splitLongSentences,
  romanizeForeignSounds,
  _internals: { applyHepburnMacrons, joinSplitOkurigana },
};
