// Grammar points → romaji for romaji readers (2026-11-10)
//
// Grammar points come from the kanji-first draft and were never converted, so
// romaji readers saw "～予定（よてい）です" and kanji example sentences (#206).
// Older articles are worse: half-converted mixes like "~to 考ete imasu",
// "~wo 助keru". Running the whole-text converter on them also put macrons on
// English words ("nēd", "thōgh"), so this converts only the Japanese runs:
//   - kana and kanji-with-furigana → romaji via the article converter
//   - bare kanji → the reading from the JLPT word list, but only when the list
//     has exactly one reading for it; otherwise the kanji stays (a wrong
//     reading would teach the wrong word)
// Runs at display time (spellOutArticle), so stored articles are fixed too.

const fs = require('fs');
const path = require('path');
const wanakana = require('wanakana');
const { convertKanjiFuriganaToRomaji, _internals: { applyHepburnMacrons } } = require('./script-converter');

const KANA = '\\u3040-\\u30FF';
const KANJI = '\\u4E00-\\u9FFF\\u3005';
// One Japanese run: kanji/kana, optional furigana in full-width brackets, joined by
// Japanese punctuation or single spaces between Japanese tokens.
const TOKEN = `[${KANA}${KANJI}]+(?:（[${KANA}]+）[${KANA}]*)*`;
const RUN = new RegExp(`${TOKEN}(?:[ 　、。]*${TOKEN})*[、。]?`, 'g');
const BARE_KANJI = new RegExp(`[${KANJI}]+`, 'g');

// Kanji stem → set of kana readings, from the JLPT CSVs (Kanji,Reading):
// 考える/かんがえる → 考: かんが ; 予定/よてい → 予定: よてい
let STEM_READINGS = null;
const WHOLE_WORDS = new Set();   // kanji-only list entries (必要, 予定): a word, not a stem
function stemReadings() {
  if (STEM_READINGS) return STEM_READINGS;
  STEM_READINGS = new Map();
  const dir = path.join(__dirname, 'data', 'jlpt-vocab');
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!file.endsWith('.csv')) continue;
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).slice(1)) {
      const [word = '', reading = ''] = line.split(',').map(s => s.trim());
      const m = word.match(new RegExp(`^([${KANJI}]+)([${KANA}]*)$`));
      if (!m || !reading || !reading.endsWith(m[2])) continue;
      const stemReading = reading.slice(0, reading.length - m[2].length);
      if (!stemReading) continue;
      if (!m[2]) WHOLE_WORDS.add(m[1]);
      if (!STEM_READINGS.has(m[1])) STEM_READINGS.set(m[1], new Set());
      STEM_READINGS.get(m[1]).add(stemReading);
    }
  }
  return STEM_READINGS;
}

function kanaToRomaji(kana) {
  return applyHepburnMacrons(wanakana.toRomaji(kana));
}

/** Convert the Japanese runs in a (possibly mixed English) string. */
function romanizeText(text) {
  if (typeof text !== 'string') return text;
  let out = text.replace(RUN, (run, offset, whole) => {
    let r = convertKanjiFuriganaToRomaji(run).replace(/,(?=\S)/g, ', ');
    // The converter capitalises like a sentence start; mid-sentence keep it lowercase
    if (offset > 0 && !/[.!?。]\s*$/.test(whole.slice(0, offset))) r = r.replace(/^[A-ZĀĪŪĒŌ]/, c => c.toLowerCase());
    return r;
  });
  // Bare kanji left over (no furigana): use the JLPT reading when it is unambiguous
  out = out.replace(BARE_KANJI, (kanji, offset, whole) => {
    const readings = stemReadings().get(kanji);
    if (!readings || readings.size !== 1) return kanji;
    const romaji = kanaToRomaji([...readings][0]);
    // A whole word glued to a romaji particle: "必要ga" → "hitsuyō ga"; a stem keeps its ending ("考ete" → "kangaete")
    return WHOLE_WORDS.has(kanji) && /^[a-z]/.test(whole.slice(offset + kanji.length)) ? `${romaji} ` : romaji;
  });
  return out;
}

/** Romaji copy of one grammar point { pattern, level, explanation, examples }. */
function romanizeGrammarPoint(point) {
  if (!point || typeof point !== 'object') return point;
  const out = { ...point };
  const japanese = new RegExp(`[${KANA}${KANJI}]`);
  if (typeof point.pattern === 'string' && japanese.test(point.pattern)) {
    out.pattern = romanizeText(point.pattern);
    // Bare "予定です" in the English explanation = the pattern without furigana
    const plain = point.pattern.replace(/（[^）]*）/g, '').replace(/^[～~]\s*/, '').trim();
    const plainRomaji = out.pattern.replace(/^[～~]\s*/, '').trim();
    if (plain && japanese.test(plain) && typeof point.explanation === 'string') {
      out.explanation = point.explanation.split(plain).join(plainRomaji);
    }
  }
  out.explanation = romanizeText(out.explanation);
  // Old half-converted examples ("keikakuwokangae直sukamoshiremasen") can't be
  // read reliably — hide the ones that still contain kanji or kana.
  if (Array.isArray(point.examples)) out.examples = point.examples.map(romanizeText).filter(e => !japanese.test(e));
  return out;
}

module.exports = { romanizeGrammarPoint, _internals: { romanizeText, stemReadings } };
