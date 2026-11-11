// Proper nouns: capitals and word spacing (2026-11-11)
//
// The kanji→romaji converter can't tell a name from a word, so names came out
// lowercase and katakana compounds glued: "nagano ken no karuizawa",
// "purinsugurandorizōtokaruizawa" (#211). The article draft now lists its
// proper nouns with romaji ({ja: "軽井沢", romaji: "Karuizawa"}); this applies
// them to the converted text.
//
// Safety: Claude's romaji is NOT trusted for spelling (that is what the
// kanji-first pipeline avoids). A name is applied only where the converted
// text has exactly the same letters (ignoring case, spaces, hyphens and
// macrons); the letters, macrons included, are kept from the text and only
// the capitals and spacing come from the name list.

const FOLD = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o', Ā: 'a', Ī: 'i', Ū: 'u', Ē: 'e', Ō: 'o' };
const fold = c => FOLD[c] || c.toLowerCase();
const LETTER = /[A-Za-zāīūēōĀĪŪĒŌ]/;

/**
 * @param {string} text - converted romaji (title, summary or body)
 * @param {{ja?: string, romaji: string}[]} names
 * @returns {string}
 */
function applyProperNouns(text, names) {
  if (!text || !Array.isArray(names) || names.length === 0) return text;
  let out = text;
  // Longest first, so "Purinsu Gurando Rizōto Karuizawa" wins over "Karuizawa"
  const sorted = names
    .map(n => String(n && n.romaji || '').trim())
    .filter(r => r && /[A-Za-z]/.test(r) && r.replace(/[^A-Za-zāīūēōĀĪŪĒŌ]/g, '').length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const name of sorted) {
    const letters = [...name].filter(c => LETTER.test(c));
    // Each letter matches itself or its macron/plain twin; spaces/hyphens optional between letters
    const pattern = letters
      .map(c => {
        const f = fold(c);
        const twins = Object.keys(FOLD).filter(k => FOLD[k] === f);
        return `[${f}${f.toUpperCase()}${twins.join('')}]`;
      })
      // spaces/hyphens between letters are optional; a vocabulary marker
      // ("fukui [NEW] ken", 2026-11-11 dry run) may sit there too
      .join('(?:\\s*\\[(?:NEW|REVIEW)\\]\\s*|[\\s-])?');
    const re = new RegExp(`(?<![A-Za-zāīūēōĀĪŪĒŌ])${pattern}(?![A-Za-zāīūēōĀĪŪĒŌ])`, 'g');
    out = out.replace(re, match => rebuild(match, name));
  }
  return out;
}

/** Text letters (with their macrons), name's capitals and separators.
 *  [NEW]/[REVIEW] markers inside the match stay before the same letter;
 *  the separator there becomes a space so the marker stays its own token. */
function rebuild(match, name) {
  const textLetters = [];
  const markers = {};
  for (const m of match.matchAll(/\[(?:NEW|REVIEW)\]|[A-Za-zāīūēōĀĪŪĒŌ]/g)) {
    if (m[0].length > 1) markers[textLetters.length] = m[0];
    else textLetters.push(m[0]);
  }
  let i = 0;
  let result = '';
  for (const c of name) {
    if (LETTER.test(c)) {
      if (markers[i]) result = result.replace(/[\s-]*$/, result ? ' ' : '') + markers[i] + ' ';
      const t = textLetters[i++];
      result += c === c.toUpperCase() && c !== c.toLowerCase() ? t.toUpperCase() : t.toLowerCase();
    } else if (/[\s-]/.test(c) && !/\s$/.test(result)) {
      result += c;
    }
  }
  return result;
}

module.exports = { applyProperNouns };
