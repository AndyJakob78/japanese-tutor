// Word levels: is a word inside the learner's level?
//
// Until now the writer decided by feel which words are "new". This file
// gives the code check real data, so a hard word that is not marked [NEW]
// is found by a program.
//
// Data (in multilang/data/, see SOURCES.md there):
//   en-cefrj.csv       CEFR-J Wordlist: English words with their level A1-B2
//   de-frequency.txt   German word forms ordered by how often they are used;
//                      there is no openly licensed German list by level, so
//                      the position in this list stands in for the level
// If a file is missing, load() returns null and the check is skipped.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const ORDER = ['A1', 'A2', 'B1', 'B2'];
const TOP = { 'A1-A2': 'A2', B1: 'B1', B2: 'B2' };

// ---------- English: look up the dictionary form ----------
const IRREGULAR = {
  was: 'be', were: 'be', been: 'be', is: 'be', are: 'be', am: 'be', has: 'have', had: 'have', did: 'do', done: 'do', does: 'do',
  went: 'go', gone: 'go', came: 'come', saw: 'see', seen: 'see', said: 'say', made: 'make', took: 'take', taken: 'take',
  got: 'get', gave: 'give', given: 'give', found: 'find', told: 'tell', knew: 'know', known: 'know', thought: 'think',
  left: 'leave', felt: 'feel', became: 'become', began: 'begin', begun: 'begin', kept: 'keep', held: 'hold', brought: 'bring',
  wrote: 'write', written: 'write', stood: 'stand', lost: 'lose', paid: 'pay', met: 'meet', ran: 'run', sat: 'sit', spoke: 'speak',
  spoken: 'speak', grew: 'grow', grown: 'grow', won: 'win', bought: 'buy', sent: 'send', built: 'build', fell: 'fall', fallen: 'fall',
  sold: 'sell', flew: 'fly', flown: 'fly', rose: 'rise', risen: 'rise', drove: 'drive', driven: 'drive', broke: 'break', broken: 'break',
  spent: 'spend', led: 'lead', caught: 'catch', taught: 'teach', chose: 'choose', chosen: 'choose', ate: 'eat', eaten: 'eat',
  drew: 'draw', drawn: 'draw', threw: 'throw', thrown: 'throw', wore: 'wear', worn: 'wear', hid: 'hide', hidden: 'hide',
  men: 'man', women: 'woman', children: 'child', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse', lives: 'life',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad', more: 'much', most: 'much', less: 'little', least: 'little',
};

function englishCandidates(w) {
  const c = [w];
  if (IRREGULAR[w]) c.push(IRREGULAR[w]);
  const add = x => { if (x.length >= 2) c.push(x); };
  if (w.endsWith("'s") || w.endsWith('’s')) add(w.slice(0, -2));
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s')) add(w.slice(0, -1));
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (w.at(-3) === w.at(-4)) add(w.slice(0, -3)); }
  if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); if (w.at(-4) === w.at(-5)) add(w.slice(0, -4)); }
  if (w.endsWith('ly')) { add(w.slice(0, -2)); if (w.endsWith('ily')) add(w.slice(0, -3) + 'y'); }
  if (w.endsWith('er')) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (w.endsWith('ier')) add(w.slice(0, -3) + 'y'); }
  if (w.endsWith('est')) { add(w.slice(0, -3)); add(w.slice(0, -2)); if (w.endsWith('iest')) add(w.slice(0, -4) + 'y'); }
  return c;
}

/** Parse the CEFR-J file: "headword,pos,CEFR,..." → Map(word → lowest level). */
function parseCefrj(csv) {
  const map = new Map();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [head, , lvl] = line.split(',');
    if (!head || !ORDER.includes(lvl)) continue;
    for (const w of head.toLowerCase().split('/')) {
      const key = w.trim();
      if (key && (!map.has(key) || ORDER.indexOf(lvl) < ORDER.indexOf(map.get(key)))) map.set(key, lvl);
    }
  }
  return map;
}

/** Parse a frequency file: one "word count" per line, most frequent first → Map(word → position). */
function parseFrequency(txt) {
  const map = new Map();
  let rank = 0;
  for (const line of txt.split(/\r?\n/)) {
    const w = line.split(/\s+/)[0].toLowerCase();
    if (!w) continue;
    rank++;
    if (!map.has(w)) map.set(w, rank);
  }
  return map;
}

/**
 * Build the lookup for one language.
 * @returns {{ known(word, level): boolean }}
 */
function makeLookup(lang, data) {
  if (lang.key === 'en') {
    // lowest level of any dictionary form ("times" → "time" A1, not "times" B2)
    const levelOf = w => englishCandidates(w).reduce((best, c) => {
      const l = data.get(c);
      return l && (best === null || ORDER.indexOf(l) < ORDER.indexOf(best)) ? l : best;
    }, null);
    return {
      known(word, level) {
        const w = word.toLowerCase();
        const parts = w.split('-').filter(p => p.length >= 4); // "solar-powered": both parts must be known; "non-", "re-" are ignored
        if (!parts.length) return levelOf(w) !== null;
        return parts.every(p => { const l = levelOf(p); return l !== null && ORDER.indexOf(l) <= ORDER.indexOf(TOP[level]); });
      },
    };
  }
  // German: position in the frequency list. A compound of two known words counts as known.
  const limit = level => lang.levels[level].knownRank;
  // The list holds word forms, so an ending can push a common word far down
  // ("regelmäßigen"). Try the form without its ending too and take the best.
  const forms = w => {
    const c = [w];
    for (const end of ['en', 'er', 'es', 'em', 'e', 'n', 's', 'ern', 'ste', 'sten', 'de', 'den', 'd']) {
      if (w.endsWith(end) && w.length - end.length >= 3) c.push(w.slice(0, -end.length));
    }
    // verb forms: "weicht" → "weichen"
    for (const end of ['t', 'te', 'ten', 'st']) if (w.endsWith(end) && w.length - end.length >= 3) c.push(w.slice(0, -end.length) + 'en');
    // plural with umlaut: "länder" → "land"
    for (const f of [...c]) { const plain = f.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u'); if (plain !== f) c.push(plain); }
    return c;
  };
  const inList = (w, level) => forms(w).some(f => data.has(f) && data.get(f) <= limit(level));
  return {
    known(word, level) {
      const w = word.toLowerCase();
      if (inList(w, level)) return true;
      for (let i = 3; i <= w.length - 3; i++) {
        const a = w.slice(0, i), b = w.slice(i);
        if ((inList(a, level) || (a.endsWith('s') && inList(a.slice(0, -1), level))) && inList(b, level)) return true;
      }
      return false;
    },
  };
}

const FILES = { en: ['en-cefrj.csv', parseCefrj], de: ['de-frequency.txt', parseFrequency] };
const cache = {};

/** Load the lookup for a language, or null when the data file is not there. */
function load(lang) {
  if (lang.key in cache) return cache[lang.key];
  const [file, parse] = FILES[lang.key] || [];
  const full = file && path.join(DATA, file);
  cache[lang.key] = full && fs.existsSync(full) ? makeLookup(lang, parse(fs.readFileSync(full, 'utf8'))) : null;
  return cache[lang.key];
}

/** Names from the news data (people, places, companies) — never counted as hard words. */
function namesFrom(news, { everyWord = false } = {}) {
  const names = new Set();
  const text = JSON.stringify(news || {});
  for (const m of text.matchAll(/(?<![\p{L}])\p{Lu}[\p{L}'’-]+/gu)) names.add(m[0].toLowerCase());
  // The news facts are in English. A word of a GERMAN article that also stands
  // in the facts letter for letter is a name or a term kept as it is
  // ("perfringens"), not German vocabulary.
  if (everyWord) for (const m of text.matchAll(/(?<![\p{L}])[\p{L}]{5,}/gu)) names.add(m[0].toLowerCase());
  return names;
}

module.exports = { load, makeLookup, parseCefrj, parseFrequency, namesFrom, _internals: { englishCandidates } };
