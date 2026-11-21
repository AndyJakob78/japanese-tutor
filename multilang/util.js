// Small helpers shared by the language files and the checker.

/** Regex for whole words; works with umlauts (JavaScript's \b does not). */
function words(alternatives, flags = 'u') {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, flags.includes('u') ? flags : flags + 'u');
}

const MARKER_RE = /\[(?:NEW|REVIEW)\]\s*/g;
const stripMarkers = t => String(t || '').replace(MARKER_RE, '');
const hasJapanese = t => /[぀-ヿ一-鿿]/.test(String(t || ''));

module.exports = { words, stripMarkers, hasJapanese, MARKER_RE };
