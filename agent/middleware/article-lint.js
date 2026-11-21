// Article lint — a code check that runs on EVERY article (2026-11-21).
//
// Why: the same kinds of mistakes kept coming back in new articles (#214,
// #216, #217, #218, #219) because nothing but a prompt stood in their way.
// A prompt is advice; this file is a gate. It costs no Claude call and no
// measurable time (plain string checks).
//
// How it is used (see agent/pipeline.js):
//   1. lintDraft()    — on the kanji draft, before conversion to romaji
//   2. lintArticle()  — on the romaji article, BEFORE the quality reviewer.
//                       The findings are handed to the reviewer call that runs
//                       anyway, as a concrete must-fix list.
//   3. lintArticle()  — again AFTER the reviewer. Whatever is left is logged
//                       and saved on the article as `lint_warnings`, so we can
//                       see what still slips through (scripts/lint-articles.js).
//
// How it grows: every problem a reader reports becomes
//   - a line in KNOWN_PHRASES below (or a new rule), and
//   - a case in test/article-lint.test.js.
// So a reported mistake can't silently come back.

const { spellOutNumbers, fixStoredSpelling } = require('./spell-numbers');
const { lookupLevel } = require('./jlpt-levels');

const FOLD = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' };
const fold = t => t.toLowerCase().replace(/[āīūēō]/g, c => FOLD[c]);
const stripMarkers = t => String(t || '').replace(/\[(?:NEW|REVIEW)\]\s*/g, '');

/** Split romaji text into sentences (markers removed). */
function splitSentences(text) {
  return stripMarkers(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Known bad phrases. `re` is matched against the marker-free romaji body.
// `levels`: only flag for these learner levels (omit = always).
// Add one line per reported problem — and one test case.
// ---------------------------------------------------------------------------
const LOW = ['N5', 'N4'];
const KNOWN_PHRASES = [
  // --- grammar above N4 (replace with the simple form) ---
  { rule: 'grammar-level', levels: LOW, re: /(?<!ō )\bto ?shite\b(?! i(?:masu|mashita|ru|ta|nai)\b)/i, hint: '"toshite" (as a …) is N3 — rephrase with N4 grammar ("… ni natte", "… no shigoto wo shite")' },
  { rule: 'grammar-level', levels: LOW, re: /\bni totte\b/i, hint: '"ni totte" is N3 — use "ni wa" or rephrase' },
  { rule: 'grammar-level', levels: LOW, re: /\bni (?:yotte|yori)\b/i, hint: '"ni yotte" is N3 — use "de"' },
  { rule: 'grammar-level', levels: LOW, re: /\bni taishite\b/i, hint: '"ni taishite" is N3 — use "ni"' },
  { rule: 'grammar-level', levels: LOW, re: /\bni (?:oite|okeru)\b/i, hint: '"ni oite" is N2 — use "de"' },
  { rule: 'grammar-level', levels: LOW, re: /\bni (?:kanshite|kansuru)\b/i, hint: '"ni kanshite" is N3 — use "ni tsuite"' },
  { rule: 'grammar-level', levels: LOW, re: /\bwo megutte\b/i, hint: '"wo megutte" is N2 — use "ni tsuite"' },
  { rule: 'grammar-level', levels: LOW, re: /\b(?:da )?to (?:iwarete|sarete) i(?:masu|ru|mashita)\b/i, hint: 'passive hearsay "to iwarete imasu" is above N4 — use "… sō desu" or name who said it' },
  { rule: 'grammar-level', levels: LOW, re: /\bzaru wo enai\b|\btsutsu aru\b|\bmono no\b(?= )|\bni mo kakawarazu\b/i, hint: 'N2 grammar — rewrite with N4 grammar' },
  // --- word-for-word English / vague stand-ins ---
  { rule: 'calque', re: /\b[A-ZĀĪŪĒŌ][a-zāīūēō]+ no kuni (?:wa|ga|no|mo)\b/, hint: '"<country> no kuni" for the government — write "<country> no seifu" (#218)' },
  { rule: 'calque', re: /\batarashii hito to ?shite\b/i, hint: '"atarashii hito toshite" is word-for-word English ("as a new person") — say what happened, e.g. "hajimete shi no giin ni narimashita" (#219)' },
  { rule: 'calque', re: /\b(?:no )?yunitto\b/i, hint: '"yunitto" for a company unit — write "kaisha" / "kogaisha" (#216)' },
  { rule: 'calque', re: /\bsono hito ka dō ?ka\b/i, hint: 'vague "sono hito ka dōka" — write "honnin ka dōka kakunin shimasu" (#216)' },
  { rule: 'calque', re: /\bnishi no kuni\b/i, hint: '"nishi no kuni" changes the meaning — name the countries or say "Ōbei" with a short explanation (#214)' },
  // --- sentences about the article itself ---
  { rule: 'meta', re: /\bkono nyūsu wo (?:kakimashita|tsutaemashita|dashimashita)\b/i, hint: 'a sentence about who reported the news is not news — delete it (#218)' },
];

// A sentence must not end on a bare particle: "Tekisasu no Sutābēsu de." (#217)
const FRAGMENT_RE = /(?:^|\s)(?:de|ni|wo|ga|wa|no|to|e|mo|ya)[.!?]$/i;

// Words that carry no content, for the repetition check.
const stem = w => fold(w).replace(/[^a-z']/g, '').slice(0, 5);
const STOP = new Set(('kara made yori desu deshita datta imasu imashita imasen arimasu arimashita arimasen shimasu shimashita ' +
  'shimasen suru shite kono sono ano kore sore are soshite demo dakara mata totemo koto mono tame mada ōku hito ' +
  'san sama kun chan narimasu narimashita dekimasu dekimasen dekimashita').split(' ').map(stem));
// Names (capitalised mid-sentence) and numbers don't count: two sentences about
// the same person are not a repetition.
const contentStems = s => new Set(s.split(/\s+/).slice(1).filter(w => !/^[A-ZĀĪŪĒŌ]/.test(w) && !/\d/.test(w))
  .concat(s.split(/\s+/).slice(0, 1).filter(w => !/\d/.test(w)))
  .map(stem).filter(w => w.length >= 3 && !STOP.has(w)));

/** Pairs of sentences that say (almost) the same thing. */
function findRepeats(sentences) {
  const sets = sentences.map(contentStems);
  const out = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const [small, big] = sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
      if (small.size < 3) continue;
      const shared = [...small].filter(w => big.has(w)).length;
      // 3 content words: all must recur; 4 or more: three quarters
      if (small.size === 3 ? shared === 3 : shared / small.size >= 0.75) out.push([sentences[i], sentences[j]]);
    }
  }
  return out;
}

/**
 * Check a romaji article. Returns [{ rule, quote, hint }].
 * @param {{body_romaji?: string, title_romaji?: string, summary_romaji?: string}} article
 * @param {{proficiency_level?: string}} config
 */
function lintArticle(article, config = {}) {
  const level = config.proficiency_level || 'N4';
  const findings = [];
  const add = (rule, quote, hint) => findings.push({ rule, quote: String(quote).trim().slice(0, 160), hint });
  const body = stripMarkers(article.body_romaji);
  const all = [article.title_romaji, article.summary_romaji, body].map(stripMarkers).join('\n');

  // 1. Digits the app can't read aloud as Japanese. What the reader sees is
  //    the text AFTER number spelling, so check that.
  const shown = spellOutNumbers(fixStoredSpelling(all));
  for (const m of shown.matchAll(/\S*\d+[a-zāīūēō]{2,}\S*/g)) {
    if (/[aiueoāīūēō]/.test(m[0].replace(/^\S*?\d+/, ''))) add('digits', m[0], 'the app cannot read this number — keep the DIGITS (never spell a number yourself), but separate them from the word before and use a standard counter: "44-ninme", "3-kai", "2026-nen"');
  }
  // 2. A reading repeated in brackets: "nijūroku(nijūroku)"
  for (const m of shown.matchAll(/([A-Za-zāīūēō]+)\(([^)]{1,40})\)/g)) {
    if (fold(m[1]).replace(/[^a-z]/g, '') === fold(m[2]).replace(/[^a-z]/g, '')) add('doubled-reading', m[0], 'the same word twice — remove the bracket');
  }
  // 3. Name + honorific without hyphen: "Raman san"
  for (const m of shown.matchAll(/\b[A-ZĀĪŪĒŌ][A-Za-zāīūēō]+ (?:san|sama|kun|chan)(?= (?:wa|ga|no|wo|ni|to|mo)\b|[.,])/g)) {
    add('honorific', m[0], 'write name + honorific with a hyphen: "Raman-san"');
  }

  const sentences = splitSentences(article.body_romaji);
  // 4. Sentence fragments
  for (const s of sentences) {
    if (FRAGMENT_RE.test(s)) add('fragment', s, 'not a full sentence (ends on a particle) — join it to the sentence before or after');
  }
  // 5. Repetition
  for (const [a, b] of findRepeats(sentences)) {
    add('repeat', `${a} / ${b}`, 'possible repetition — if both say the same thing, keep one or merge them; if they are two different facts, leave both');
  }
  // 6. Known phrases
  for (const p of KNOWN_PHRASES) {
    if (p.levels && !p.levels.includes(level)) continue;
    const m = body.match(p.re);
    if (m) add(p.rule, sentences.find(s => p.re.test(s)) || m[0], p.hint);
  }
  return findings;
}

// Long loanwords an N4 reader meets all the time — never flagged.
const COMMON_LOANWORDS = new Set(['スマートフォン', 'コンピューター', 'コンピュータ', 'インターネット', 'プログラミング', 'エネルギー',
  'オリンピック', 'パラリンピック', 'ワールドカップ', 'チャンピオン', 'レストラン', 'スーパーマーケット', 'アルバイト', 'コミュニケーション',
  'インタビュー', 'ボランティア', 'トレーニング', 'プレゼント', 'キャラクター', 'アプリケーション', 'オンライン', 'テクノロジー',
  'スケジュール', 'エレベーター', 'エスカレーター', 'チョコレート', 'ハンバーガー', 'ウイルス', 'ワクチン', 'ロボット']);

/**
 * Check the kanji draft (before conversion): long katakana words that are in
 * no JLPT list and are not a listed proper noun. "デモクラティック
 * ソーシャリスト" reached an N4 reader as raw English (#219).
 * @param {string} draftBody - body in kanji + furigana
 * @param {{ja?: string}[]} properNouns
 * @param {(kana: string) => string} toRomaji
 */
function lintDraft(draftBody, properNouns = [], toRomaji = x => x) {
  const names = (properNouns || []).map(n => String(n && n.ja || '')).join(' ');
  const findings = [];
  const seen = new Set();
  for (const m of String(draftBody || '').matchAll(/[ァ-ヺー]{7,}/g)) {
    const word = m[0];
    if (seen.has(word) || COMMON_LOANWORDS.has(word) || names.includes(word) || lookupLevel({ word_kana: word })) continue;
    seen.add(word);
    findings.push({ rule: 'loanword', quote: toRomaji(word), hint: 'long English loanword not in any JLPT list — if it is not a name, replace it with simple Japanese or explain it in a few simple words' });
  }
  return findings;
}

/** Findings as a prompt block for the reviewer ('' when there are none). */
function formatForReviewer(findings) {
  if (!findings || findings.length === 0) return '';
  const lines = findings.slice(0, 12).map((f, i) => `${i + 1}. [${f.rule}] "${f.quote}" — ${f.hint}`);
  return `## 🔎 CODE CHECK — fix every item below (found by a program, not a guess)
${lines.join('\n')}
Fix each one inside its sentence with words at or below the user's level, keep [NEW]/[REVIEW] markers on their words, add no new facts, and update translation_en where the meaning changes. For [repeat] you may delete the weaker sentence (this deletion is allowed).`;
}

/** Short strings for logs and the article document. */
const summarize = findings => (findings || []).map(f => `${f.rule}: ${f.quote}`);

module.exports = { lintArticle, lintDraft, formatForReviewer, summarize, splitSentences, _internals: { findRepeats, KNOWN_PHRASES } };
