// Spell out numbers in romaji text for display (2026-11-08, user request).
//
// The pipeline stores numbers as digits ("11gatsu 6ka", "5tsu", "45 pāsento").
// The learner wants to read them in Japanese: "jūichigatsu muika", "itsutsu",
// "yonjūgo pāsento". This runs when an article or quiz is sent to the app, so
// stored data keeps its digits and old articles get the new display too.
//
// Readings follow standard counter sound changes (ippun, sanbyaku, yokka,
// hatachi...). A digit run is only converted when it stands alone or is
// followed by a known counter / unit; anything else (M6, 5G, iPhone 17,
// 10:30, "12chōme") stays as digits rather than risk a wrong reading.

const ONES = ['', 'ichi', 'ni', 'san', 'yon', 'go', 'roku', 'nana', 'hachi', 'kyū'];
const HUNDREDS = ['', 'hyaku', 'nihyaku', 'sanbyaku', 'yonhyaku', 'gohyaku', 'roppyaku', 'nanahyaku', 'happyaku', 'kyūhyaku'];
const THOUSANDS = ['', 'sen', 'nisen', 'sanzen', 'yonsen', 'gosen', 'rokusen', 'nanasen', 'hassen', 'kyūsen'];

/**
 * Read 1–9999 as a list of words; the last word is the one a counter
 * attaches to. Tens and ones form one word (nijūroku).
 *   2026 → ['nisen', 'nijūroku'], 300 → ['sanbyaku'], 14 → ['jūyon']
 * `last` reports the final element ('1'–'9', 'jū', 'hyaku', 'sen') so
 * counters can apply sound changes (jukkai, hyakkai...).
 */
function readUnder10000(n, beforeMan = false) {
  const words = [];
  const th = Math.floor(n / 1000), hu = Math.floor(n / 100) % 10, te = Math.floor(n / 10) % 10, on = n % 10;
  // 1000 before man/oku is "issen" (issenman), otherwise "sen"
  if (th) words.push(th === 1 && beforeMan && !hu && !te && !on ? 'issen' : THOUSANDS[th]);
  if (hu) words.push(HUNDREDS[hu]);
  if (te || on) words.push((te > 1 ? ONES[te] : '') + (te ? 'jū' : '') + ONES[on]);
  const last = on ? String(on) : te ? 'jū' : hu ? 'hyaku' : 'sen';
  return { words, last };
}

/** Read any integer 1 – 999,999,999,999. Returns { words, last, value }. */
function readNumber(n) {
  if (n === 0) return { words: ['zero'], last: '0', value: 0 };
  const words = [];
  let last = '';
  const oku = Math.floor(n / 1e8), man = Math.floor(n / 1e4) % 1e4, rest = n % 1e4;
  if (oku) { words.push(...joinUnit(readUnder10000(oku, true).words, 'oku')); last = 'oku'; }
  if (man) { words.push(...joinUnit(readUnder10000(man, true).words, 'man')); last = 'man'; }
  if (rest) { const r = readUnder10000(rest); words.push(...r.words); last = r.last; }
  return { words, last, value: n };
}

// "ichi" before man/oku: 10000 = ichiman, 1e8 = ichioku
function joinUnit(words, unit) {
  const w = words.length ? [...words] : ['ichi'];
  w[w.length - 1] = w[w.length - 1] + unit;
  return w;
}

// Counter rules: `forms` replaces the reading of the final element
// (keyed by ones digit, 'jū', 'hyaku'...); everything else is base + suffix.
// `whole` holds full-word exceptions for exact values (hitori, hatachi...).
const GEMINATE_K = { 1: 'ik', 6: 'rok', 8: 'hak', 'jū': 'juk', 'hyaku': 'hyak' };
function geminateK(suffix) {
  const f = {};
  for (const [k, v] of Object.entries(GEMINATE_K)) f[k] = v + suffix;
  return f;
}

const DAYS = {
  1: 'tsuitachi', 2: 'futsuka', 3: 'mikka', 4: 'yokka', 5: 'itsuka', 6: 'muika',
  7: 'nanoka', 8: 'yōka', 9: 'kokonoka', 10: 'tōka', 14: 'jūyokka', 20: 'hatsuka', 24: 'nijūyokka',
};
const DAY_RULE = { suffix: 'nichi', whole: DAYS, forms: { 4: 'yokka', 7: 'shichinichi', 9: 'kunichi' }, max: 31 };

const COUNTERS = {
  gatsu:   { suffix: 'gatsu', forms: { 4: 'shigatsu', 7: 'shichigatsu', 9: 'kugatsu' }, max: 12 },
  nichi:   DAY_RULE,
  ka:      DAY_RULE,
  tsu:     { suffix: 'tsu', whole: { 1: 'hitotsu', 2: 'futatsu', 3: 'mittsu', 4: 'yottsu', 5: 'itsutsu', 6: 'muttsu', 7: 'nanatsu', 8: 'yattsu', 9: 'kokonotsu', 10: 'tō' }, max: 10 },
  nin:     { suffix: 'nin', whole: { 1: 'hitori', 2: 'futari' }, forms: { 4: 'yonin', 7: 'shichinin', 9: 'kyūnin' } },
  nen:     { suffix: 'nen', forms: { 4: 'yonen', 9: 'kyūnen' } },
  nenkan:  { suffix: 'nenkan', forms: { 4: 'yonenkan', 9: 'kyūnenkan' } },
  gō:      { suffix: 'gō' },
  chō:     { suffix: 'chō' },
  ji:      { suffix: 'ji', forms: { 4: 'yoji', 7: 'shichiji', 9: 'kuji' }, max: 24 },
  jikan:   { suffix: 'jikan', forms: { 4: 'yojikan', 9: 'kujikan' } },
  fun:     { suffix: 'fun', forms: { 1: 'ippun', 3: 'sanpun', 4: 'yonpun', 6: 'roppun', 8: 'happun', 'jū': 'juppun', 'hyaku': 'hyappun' } },
  kai:     { suffix: 'kai', forms: geminateK('kai') },
  kaime:   { suffix: 'kaime', forms: geminateK('kaime') },
  kagetsu: { suffix: 'kagetsu', forms: geminateK('kagetsu') },
  kakoku:  { suffix: 'kakoku', forms: geminateK('kakoku') },
  ko:      { suffix: 'ko', forms: geminateK('ko') },
  shūkan:  { suffix: 'shūkan', forms: { 1: 'isshūkan', 8: 'hasshūkan', 'jū': 'jusshūkan' } },
  sai:     { suffix: 'sai', whole: { 20: 'hatachi' }, forms: { 1: 'issai', 8: 'hassai', 'jū': 'jussai' } },
  hon:     { suffix: 'hon', forms: { 1: 'ippon', 3: 'sanbon', 6: 'roppon', 8: 'happon', 'jū': 'juppon', 'hyaku': 'hyappon' } },
  ken:     { suffix: 'ken', forms: { 1: 'ikken', 3: 'sangen', 6: 'rokken', 8: 'hakken', 'jū': 'jukken' } },
  en:      { suffix: 'en', forms: { 4: 'yoen', 9: 'kyūen' } },
  man:     { suffix: 'man' },
  oku:     { suffix: 'oku' },
  mai:     { suffix: 'mai' },
  dai:     { suffix: 'dai' },
  do:      { suffix: 'do' },
  bai:     { suffix: 'bai' },
  ban:     { suffix: 'ban' },
  banme:   { suffix: 'banme' },
  bu:      { suffix: 'bu' },
  wari:    { suffix: 'wari' },
  peeji:   { suffix: 'pēji' },
  pēji:    { suffix: 'pēji' },
};

// Loanword units: plain reading, then a space ("yonjūgo pāsento").
const UNITS = ['pāsento', 'paasento', 'inchi', 'doru', 'yūro', 'pondo', 'gen', 'mētoru', 'senchi', 'kiro', 'kiroguramu',
  'kiromētoru', 'guramu', 'rittoru', 'riitoru', 'tonna', 'ton', 'mairu', 'gigabaito', 'terabaito', 'herutsu', 'wattsu', 'do'];

function readWithCounter(n, rule, isDate) {
  if (rule.whole && rule.whole[n] && !(rule === DAY_RULE && n === 1 && !isDate)) return rule.whole[n];
  if (rule === DAY_RULE && n === 1) return 'ichinichi';
  // "1000man" is issenman; "1man" is ichiman
  if ((rule === COUNTERS.man || rule === COUNTERS.oku) && n < 1e4) return joinUnit(readUnder10000(n, true).words, rule.suffix).join(' ');
  const { words, last } = readNumber(n);
  const form = rule.forms && rule.forms[last];
  const out = [...words];
  const lastWord = out.pop();
  let tail;
  if (form) {
    // replace the final element's reading with the counter form:
    // 'jūroku' + kai → 'jū' + 'rokkai'; 'hyaku' + kai → 'hyakkai'
    // hyaku may be voiced (sanbyaku, roppyaku), so swap only "yaku":
    // 'sanbyaku' + 'hyakko' → 'sanb' + 'yakko'
    if (last === 'hyaku') tail = lastWord.slice(0, -4) + form.slice(1);
    else tail = lastWord.slice(0, lastWord.length - (last === 'jū' ? 2 : ONES[Number(last)].length)) + form;
  } else {
    // n before a vowel needs an apostrophe: san'en, man'en, sen'en
    tail = lastWord + (/n$/.test(lastWord) && /^[aeiouāīūēō]/.test(rule.suffix) ? "'" : '') + rule.suffix;
  }
  return [...out, tail].join(' ');
}

const COUNTER_RE = Object.keys(COUNTERS).sort((a, b) => b.length - a.length).join('|');
const UNIT_RE = UNITS.sort((a, b) => b.length - a.length).join('|');
const NUM_RE = new RegExp(
  // a digit run (with optional thousands commas / decimal part) not glued to a
  // letter on the left, optionally followed by a counter or unit
  `(?<![A-Za-zāīūēō0-9.,:])(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?` +
  `(?:([\\s-]?)(${COUNTER_RE})(?![a-zāīūēō])|\\s?(%)|([\\s-]?)(${UNIT_RE})(?![a-zāīūēō]))?` +
  `(?![A-Za-zāīūēō0-9:])`,
  'gi'
);

// A digit glued to a native-number word says the number twice: "1hitoheya",
// "2futari", "3mittsu" (#205). Drop the digit when the word starts with that
// number's native reading.
const NATIVE = { 1: 'hito', 2: 'futa', 3: 'mi', 4: 'yo', 5: 'itsu', 6: 'mu', 7: 'nana', 8: 'ya', 9: 'kokono', 10: 'tō' };
const DIGIT_NATIVE_RE = /(?<![A-Za-zāīūēō0-9.,:])(10|[1-9])[\s-]?((?:hito|futa|mi|yo|itsu|mu|nana|ya|kokono|tō)(?:ttsu|tsu|heya|ban|ri|kuchi|tsuki|hako|fukuro|toki|ma)\b|tsuitachi|futsuka|mikka|yokka|itsuka|muika|nanoka|yōka|kokonoka|tōka)/gi;

// Mixed digits and man/oku: "6man6027en" → "66027en", "1oku2000man" → "120000000"
// (the main pass reads the result). Plain "6man" is left to the man counter.
const MAN_OKU_RE = /(?<![A-Za-zāīūēō0-9.,:])(?:(\d{1,4})oku)?(?:(\d{1,4})man)?(\d{1,4})?(?!\d|man|oku)/g;

function spellOutNumbers(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text
    .replace(DIGIT_NATIVE_RE, (match, digits, word) =>
      word.toLowerCase().startsWith(NATIVE[digits]) || DAYS[digits] === word.toLowerCase() ? word : match)
    .replace(MAN_OKU_RE, (match, oku, man, rest) => {
      if ([oku, man, rest].filter(Boolean).length < 2) return match;
      return String(Number(oku || 0) * 1e8 + Number(man || 0) * 1e4 + Number(rest || 0));
    });
  out = out.replace(NUM_RE, (match, intPart, decimals, sep, counter, pct, _s, unit, offset, whole) => {
    const n = Number(intPart.replace(/,/g, ''));
    if (!Number.isSafeInteger(n) || n >= 1e12) return match;
    const decimalWords = decimals ? ' ten ' + [...decimals].map(d => d === '0' ? 'zero' : ONES[d]).join(' ') : '';
    // "16 ka?" with a space is the question particle, not a day
    if (counter && sep === ' ' && counter.toLowerCase() === 'ka') {
      return readNumber(n).words.join(' ') + decimalWords + match.slice(intPart.length + (decimals ? decimals.length + 1 : 0));
    }
    if (counter) {
      if (decimals) return match;
      const rule = COUNTERS[counter.toLowerCase()];
      if (rule.max && (n < 1 || n > rule.max)) return match;
      // a day number right after "...gatsu" is a date (tsuitachi), else a count (ichinichi)
      const isDate = /gatsu\s*$/i.test(whole.slice(0, offset));
      return readWithCounter(n, rule, isDate);
    }
    const plain = readNumber(n).words.join(' ') + decimalWords;
    if (pct) return plain + ' pāsento';
    if (unit) return plain + ' ' + unit;
    return plain;
  });
  // numbers that started a sentence: "2026nen wa" → "Nisen nijūrokunen wa"
  out = out.replace(/((?:^|[.!?]\s+)(?:\[(?:NEW|REVIEW)\]\s+)?)([a-zāīūēō])(?![A-Z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  return out;
}

const { romanizeGrammarPoint } = require('./grammar-romaji');

const QUIZ_FIELDS = ['question_romaji', 'correct_answer', 'hint', 'explanation'];

/**
 * Spelling fixes for articles stored before the converter was fixed
 * (2026-11-11, #211): wanakana's "vyira"/"vua" → vira/va, and glued
 * "yōna"/"yōni"/"noyōna" → "yō na"/"yō ni"/"no yō na". Native Hepburn has
 * no "v", so vy-/vu+vowel only ever came from ヴ.
 */
const FOLD_MACRONS = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' };
const foldLetters = t => t.toLowerCase().replace(/[āīūēō]/g, c => FOLD_MACRONS[c]).replace(/[^a-z]/g, '');

function fixStoredSpelling(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    // reading repeated in brackets: "pāsento(pāsento)", "pāsento (pa- sento)" → "pāsento"
    .replace(/([A-Za-zāīūēō]+)\s?\(([^)]{1,40})\)/g, (m, word, inner) => (foldLetters(inner) === foldLetters(word) ? word : m))
    // "9%(pāsento)": the % is read as pāsento anyway
    .replace(/%\s?\(\s?p[aā]-?\s?sento\s?\)/gi, '%')
    .replace(/([Vv])y([aieo])/g, '$1$2')
    .replace(/([Vv])u([aeo])/g, '$1$2')
    .replace(/(^|[^A-Za-zāīūēō])(no)?yō(na|ni)(?![A-Za-zāīūēō])/g, (m, pre, no, end) => `${pre}${no ? 'no ' : ''}yō ${end}`)
    // na-adjective glued to na: "iroirona" → "iroiro na"
    .replace(NA_ADJ_GLUED, (m, pre, adj) => `${pre}${adj} na`)
    // つ counter read with Sino-Japanese numbers: "nitsume" → "futatsume"
    .replace(/(^|[^A-Za-zāīūēō])(ichi|ni|san|yon|go|roku|hachi|kyū)tsu(me)?(?![A-Za-zāīūēō])/gi,
      (m, pre, num, me) => `${pre}${matchCase(NATIVE_TSU[num.toLowerCase()], num)}${me || ''}`);
}

const NA_ADJECTIVES = ['iroiro', 'kirei', 'suteki', 'hima', 'dame', 'genki', 'daijōbu', 'taihen', 'kantan', 'jōzu', 'heta',
  'shizuka', 'nigiyaka', 'taisetsu', 'benri', 'fuben', 'tokubetsu', 'yūmei', 'shinsetsu', 'majime', 'suki', 'kirai',
  'azayaka', 'yutaka', 'tashika', 'hitsuyō', 'anzen', 'kiken', 'jiyū', 'fushigi'];
const NA_ADJ_GLUED = new RegExp(`(^|[^A-Za-zāīūēō])(${NA_ADJECTIVES.join('|')})na(?![A-Za-zāīūēō])`, 'gi');
const NATIVE_TSU = { ichi: 'hitotsu', ni: 'futatsu', san: 'mittsu', yon: 'yottsu', go: 'itsutsu', roku: 'muttsu', hachi: 'yattsu', kyū: 'kokonotsu' };
const matchCase = (word, like) => (like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);

/**
 * Spell out numbers in an article object (and its quiz/vocab context) for a
 * romaji reader. Returns a new object; kana/kanji articles are untouched.
 */
function spellOutArticle(article) {
  if (!article || (article.writing_system && article.writing_system !== 'romaji')) return article;
  const out = { ...article };
  for (const f of ['title_romaji', 'summary_romaji', 'body_romaji']) out[f] = spellOutNumbers(fixStoredSpelling(out[f]));
  // Grammar points come from the kanji-first draft (see grammar-romaji.js)
  if (Array.isArray(out.grammar_points)) out.grammar_points = out.grammar_points.map(romanizeGrammarPoint);
  if (Array.isArray(out.quiz_questions)) {
    out.quiz_questions = out.quiz_questions.map(spellOutQuestion);
  }
  if (Array.isArray(out.vocabulary)) {
    out.vocabulary = out.vocabulary.map(v => ({ ...v, context_sentence: spellOutNumbers(v.context_sentence) }));
  }
  return out;
}

/** Spell out one quiz question object (same fields as in spellOutArticle). */
function spellOutQuestion(q) {
  const c = { ...q };
  for (const f of QUIZ_FIELDS) c[f] = spellOutNumbers(c[f]);
  if (Array.isArray(c.distractors)) c.distractors = c.distractors.map(spellOutNumbers);
  if (Array.isArray(c.options)) c.options = c.options.map(spellOutNumbers);
  return c;
}

module.exports = { spellOutNumbers, spellOutArticle, spellOutQuestion, _internals: { readNumber, readWithCounter, fixStoredSpelling } };
