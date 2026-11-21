// Known words: make the article show which words the learner has met before.
// (2026-11-21, "I want more existing vocabulary included")
//
// THE PROBLEM, seen in a test run: the writer is offered the 30 words most in
// need of review, picks the few that fit the story — often none — and then
// marks words the learner already has (kimeru, fueru, nedan, yotei) as [NEW].
// So articles looked full of "new" words and review words were rare.
//
// WHAT THIS DOES, in code, after the reviewer (no Claude call):
//   1. A [NEW] word that is already in the learner's word list becomes [REVIEW].
//   2. Words of the learner's list that appear in the article unmarked get a
//      [REVIEW] marker (first occurrence), most in need of review first, up to
//      `maxReview` review words in total.
// Names are never marked. Only romaji articles.

const VOWELS = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' };
const fold = t => String(t || '').toLowerCase().replace(/[āīūēō]/g, c => VOWELS[c]);
const L = 'A-Za-zāīūēōĀĪŪĒŌ';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Company, place and product names in the word list are not vocabulary to review. */
function isName(w) {
  return /proper noun|company name|brand name|\bname of\b|\(name\b|\bname\)/i.test(w.meaning_en || '')
    || /^[A-ZĀĪŪĒŌ]/.test(w.word_romaji_macron || '');
}

const GODAN = { ku: 'ki', gu: 'gi', su: 'shi', tsu: 'chi', nu: 'ni', bu: 'bi', mu: 'mi', ru: 'ri', u: 'i' };

/** Regex source for the forms of a word we can recognise safely: the word itself, and the polite forms of a verb. */
function formsOf(w) {
  const word = w.word_romaji_macron;
  const forms = [esc(word)];
  if (/verb/i.test(w.part_of_speech || '') && /u$/.test(word) && !/\s/.test(word)) {
    const stems = [];
    if (/[ei]ru$/.test(word)) stems.push(word.slice(0, -2));                    // taberu → tabe-
    const end = Object.keys(GODAN).find(e => word.endsWith(e));
    if (end) stems.push(word.slice(0, -end.length) + GODAN[end]);               // harau → harai-, uru → uri-
    for (const s of stems) if (s.length >= 2) forms.push(`${esc(s)}(?:masu|mashita|masen|mashō|tai)`);
  }
  return `(?:${forms.join('|')})`;
}

/**
 * @param {object} article  { body_romaji, newWords, reviewWords }
 * @param {object[]} vocab  the learner's words, most in need of review first
 * @param {{maxReview?: number, isCommon?: (word: string) => boolean}} opts
 * @returns {{converted: string[], added: string[]}} what was changed (for the log)
 */
function markKnownWords(article, vocab, { maxReview = 8, isCommon = () => false } = {}) {
  const out = { converted: [], added: [] };
  if (!article.body_romaji || !Array.isArray(vocab) || !vocab.length) return out;
  article.newWords = article.newWords || [];
  article.reviewWords = article.reviewWords || [];
  const byWord = new Map();
  for (const w of vocab) if (w.word_romaji_macron && !byWord.has(fold(w.word_romaji_macron))) byWord.set(fold(w.word_romaji_macron), w);
  const entry = (w, sentence) => ({
    word_romaji_macron: w.word_romaji_macron, word_kana: w.word_kana || null, word_kanji: w.word_kanji || null,
    meaning_en: w.meaning_en, context_sentence: sentence || '',
  });
  const has = (list, word) => list.some(x => fold(x.word_romaji_macron) === fold(word));

  // 1. [NEW] words the learner already has → [REVIEW]
  for (const nw of [...article.newWords]) {
    const known = byWord.get(fold(nw.word_romaji_macron));
    if (!known) continue;
    const stem = esc(fold(nw.word_romaji_macron).slice(0, Math.max(3, fold(nw.word_romaji_macron).length - 2)));
    let done = false;
    article.body_romaji = article.body_romaji.replace(/\[NEW\](\s*)([^\s\[\]]+)/g, (m, sp, tok) => {
      if (done || !new RegExp(`^${stem}`).test(fold(tok))) return m;
      done = true;
      return `[REVIEW]${sp}${tok}`;
    });
    if (!done) continue;
    article.newWords = article.newWords.filter(x => x !== nw);
    if (!has(article.reviewWords, known.word_romaji_macron)) article.reviewWords.push(entry(known, nw.context_sentence));
    out.converted.push(known.word_romaji_macron);
  }

  // 2. Unmarked words the learner has met → [REVIEW], most needed first
  for (const w of vocab) {
    if (article.reviewWords.length >= maxReview) break;
    const word = w.word_romaji_macron;
    if (!word || word.length < 4 || isName(w) || isCommon(word)) continue;
    if (has(article.reviewWords, word) || has(article.newWords, word)) continue;
    // whole word, not already marked, not part of a hyphenated name ("Nagano-ken")
    const re = new RegExp(`(?<![${L}\\-])(?<!\\[(?:NEW|REVIEW)\\]\\s?)(${formsOf(w)})(?![${L}\\-])`, 'i');
    const m = article.body_romaji.match(re);
    if (!m) continue;
    // A capital inside a sentence is part of a name ("Nagano Hoteru Saihokukan") — leave it alone.
    const before = article.body_romaji.slice(0, m.index).replace(/\[(?:NEW|REVIEW)\]\s*/g, '').trimEnd();
    if (/^[A-ZĀĪŪĒŌ]/.test(m[0]) && before && !/[.!?]$/.test(before)) continue;
    article.body_romaji = article.body_romaji.slice(0, m.index) + '[REVIEW] ' + article.body_romaji.slice(m.index);
    const sentence = (article.body_romaji.replace(/\[(?:NEW|REVIEW)\]\s*/g, '').match(/[^.!?]+[.!?]*/g) || []).find(s => new RegExp(re.source, 'i').test(s)) || '';
    article.reviewWords.push(entry(w, sentence.trim()));
    out.added.push(word);
  }
  return out;
}

module.exports = { markKnownWords, isName, _internals: { formsOf } };
