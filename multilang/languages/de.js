// German for Japanese-speaking learners. Levels follow the European scale
// (CEFR). "A1-A2" is one combined beginner level.
//
// Each level has
//   rules      — text given to the writer AND the reviewer
//   maxWords   — longest sentence the checker accepts
//   maxSub     — most subordinate clauses in one sentence
//   words      — target article length
//   knownRank  — a word counts as known if it is among this many most-used
//                German word forms (multilang/data/de-frequency.txt)
// `phrases` are the code checks: one line per pattern, with the levels it
// applies to. A reader-reported problem becomes a new line here plus a test.

const { words } = require('../util');

const BEGINNER = ['A1-A2'];
const UP_TO_B1 = ['A1-A2', 'B1'];

// Simple past forms that are common in news. At A1-A2 the article must use
// the Perfekt instead ("hat gesagt"). war/hatte and modal verbs are allowed.
const PRAETERITUM = [
  'sagte', 'machte', 'erklärte', 'teilte', 'berichtete', 'zeigte', 'kündigte', 'meldete', 'warnte', 'forderte',
  'betonte', 'stellte', 'legte', 'führte', 'erreichte', 'startete', 'endete', 'dauerte', 'kaufte', 'verkaufte',
  'zahlte', 'lebte', 'arbeitete', 'spielte', 'plante', 'öffnete', 'brauchte', 'suchte', 'glaubte', 'hoffte',
  'fragte', 'antwortete', 'passierte', 'folgte', 'reagierte', 'kritisierte', 'informierte', 'besuchte', 'wählte',
  'wusste', 'dachte', 'brachte', 'kannte', 'nannte',
].flatMap(v => [v, v + 'n'])
  .concat(['gab', 'gaben', 'kam', 'kamen', 'ging', 'gingen', 'stand', 'standen', 'fand', 'fanden', 'blieb', 'blieben',
    'lag', 'lagen', 'hieß', 'hießen', 'sah', 'sahen', 'nahm', 'nahmen', 'hielt', 'hielten', 'ließ', 'ließen',
    'stieg', 'stiegen', 'fiel', 'fielen', 'sank', 'sanken', 'gewann', 'gewannen', 'verlor', 'starb', 'starben',
    'begann', 'begannen', 'sprach', 'schrieb', 'schrieben', 'traf', 'trafen', 'zog', 'zogen', 'trat', 'traten',
    'entschied', 'erhielt', 'erhielten', 'bekam', 'bekamen', 'fuhr', 'fuhren', 'flog', 'flogen', 'lief', 'liefen',
    'schloss', 'schlossen', 'bot', 'boten', 'half', 'halfen', 'wuchs', 'wuchsen', 'entstand', 'verstand', 'erschien',
    'gelang', 'schien', 'rief', 'riefen', 'trug', 'trugen', 'schlug', 'schlugen', 'wurde', 'wurden']);

module.exports = {
  key: 'de',
  name: 'German',
  nativeName: 'Deutsch',
  newsRegion: 'Germany, Austria or Switzerland',
  levels: {
    'A1-A2': {
      words: 110, maxWords: 14, maxSub: 1, newWords: [4, 8], knownRank: 5500,
      rules: `- Tenses: Präsens and Perfekt only ("hat gesagt", "ist gekommen"). Präteritum ONLY for sein and haben ("war", "hatte") and modal verbs ("konnte", "wollte", "musste"). For the future use Präsens with a time word, not "werden".
- Sentences: short main clauses, 6-12 words, never more than 14. Join ideas with und, aber, oder, denn, dann, deshalb.
- Subordinate clauses: only "weil", "dass" and "wenn"; at most ONE per sentence and not in every sentence.
- NOT allowed: relative clauses, passive ("wurde ... gebaut"), Konjunktiv I and II (only "möchte" is fine), genitive (write "von" + Dativ), obwohl / während / nachdem / bevor / damit / falls, wegen / trotz / laut / aufgrund, participles used as adjectives before a noun, noun chains (use a verb instead).
- What someone said: "Der Minister sagt: ..." or "Er sagt, dass ..." with the normal verb form.
- Words: everyday A1/A2 words. Avoid long compound nouns; if one is needed, mark it [NEW].`,
    },
    B1: {
      words: 170, maxWords: 22, maxSub: 2, newWords: [5, 9], knownRank: 16000,
      rules: `- Tenses: Präteritum for the story (normal news style), Perfekt in quotes and for recent results, Plusquamperfekt only when the order of events needs it.
- Sentences: about 10-18 words, never more than 22; at most two clauses joined to a main clause.
- Allowed: weil, dass, wenn, als, ob, obwohl, während, bevor, nachdem, damit, um ... zu; simple relative clauses; passive in Präsens and Präteritum; Konjunktiv II with würde / wäre / hätte / könnte; simple genitive; wegen, trotz.
- NOT allowed: Konjunktiv I for reported speech (write "Sie sagte, dass ..." with the normal verb form), long participle phrases before a noun ("die von der Regierung geplante Reform"), chains of nouns, formal prepositions (angesichts, infolge, hinsichtlich, bezüglich, mittels).
- Words: B1 vocabulary; explain or mark [NEW] anything more formal.`,
    },
    B2: {
      words: 240, maxWords: 30, maxSub: 3, newWords: [6, 10], knownRank: 35000,
      rules: `- Style: real German news style, slightly simplified. Präteritum, passive in all tenses, genitive and Konjunktiv I for reported speech are all fine.
- Sentences: about 12-25 words, never more than 30. No clause nested three deep.
- Participle phrases before a noun: at most three words inside ("die gestern beschlossene Regel").
- NOT allowed: official or legal language without explanation, rare idioms, sentences that need to be read twice.
- Words: B2 vocabulary; mark [NEW] what is above it.`,
    },
  },

  // What the reviewer must check beyond the level rules.
  reviewChecks: `- Gender and case of every noun phrase (der/die/das, endings of articles and adjectives).
- Verb position: second place in main clauses, last place in subordinate clauses, separable prefixes at the end.
- Perfekt with the right helper verb (sein for movement and change: "ist gestiegen", not "hat gestiegen").
- Word-for-word English: "macht Sinn" is fine, but not "in 2026" (write "2026" or "im Jahr 2026"), not "realisieren" for "notice", not "es gibt" misuse.
- Numbers and dates in German form: "3,5 Prozent", "1.000", "am 21. November".`,

  // Sub-clause openers counted per sentence (comma + word).
  subordinators: /,\s+(?:weil|dass|wenn|als|ob|obwohl|während|bevor|nachdem|damit|falls|sodass|indem|seit|bis|der|die|das|den|dem|denen|deren|dessen)\s/gu,

  phrases: [
    { rule: 'tense', levels: BEGINNER, re: words(PRAETERITUM.join('|')), hint: 'Präteritum is above A1-A2 — use the Perfekt ("hat gesagt", "ist gestiegen"); only war / hatte / konnte / wollte / musste may stay' },
    { rule: 'grammar-level', levels: BEGINNER, re: /,\s+(?:der|die|das|den|dem|denen|deren|dessen)\s+(?:\S+\s+){1,10}?\S+(?:t|en|ist|sind|hat|haben|war|kann|will|muss)[,.]/u, hint: 'relative clause is above A1-A2 — make two main clauses' },
    { rule: 'grammar-level', levels: BEGINNER, re: words('obwohl|während|nachdem|bevor|damit|falls|sodass|indem|sobald|solange'), hint: 'this connector is B1 — use und / aber / denn / deshalb, or "weil" / "wenn"' },
    { rule: 'grammar-level', levels: BEGINNER, re: words('wegen|trotz|laut|aufgrund|anhand|innerhalb|außerhalb'), hint: 'this preposition is above A1-A2 — rephrase with "weil" or a verb ("X sagt: ...")' },
    { rule: 'grammar-level', levels: BEGINNER, re: words('wäre|wären|hätte|hätten|würde|würden|könnte|könnten|müsste|müssten'), hint: 'Konjunktiv II is above A1-A2 — say it directly ("kann", "will", "plant")' },
    { rule: 'grammar-level', levels: BEGINNER, re: words('des|eines') , hint: 'genitive is above A1-A2 — use "von" + Dativ ("der Chef von der Firma")' },
    { rule: 'grammar-level', levels: BEGINNER, re: /(?<![\p{L}])(?:[Dd]ie|[Dd]er|[Dd]as|[Dd]en|[Dd]em) \p{Lu}[\p{L}-]+ der \p{Lu}[\p{L}-]+/u, hint: 'genitive ("die Zeit der Sonne") is above A1-A2 — use "von" + Dativ or one compound word marked [NEW]' },
    { rule: 'grammar-level', levels: BEGINNER, re: words('(?:wird|werden)(?! \\p{L}+er(?![\\p{L}]))') , hint: '"werden" (future or passive) — at A1-A2 use Präsens with a time word, or an active sentence. Keep only if it means "to become".' }, // "wird schwächer" (becomes) is not matched
    { rule: 'grammar-level', levels: UP_TO_B1, re: words('(?:er|sie|es|man) (?:sei|habe|werde|könne|wolle|müsse|solle)|sei(?:en)?'), hint: 'Konjunktiv I (reported speech) is B2 — write "sagt, dass ..." with the normal verb form' },
    { rule: 'grammar-level', levels: UP_TO_B1, re: words('angesichts|infolge|hinsichtlich|bezüglich|mittels|zwecks|seitens'), hint: 'formal preposition — rephrase with a verb or "wegen" / "weil"' },
    { rule: 'calque', re: /(?<![\p{L}])in (?:19|20)\d\d(?!\d)/u, hint: '"in 2026" is English — write "2026" or "im Jahr 2026"' },
    { rule: 'meta', re: /(?:berichte[nt]|schreib(?:t|en)|melde[nt])\s+(?:über\s+)?(?:diese|die)\s+(?:Nachricht|Meldung|Geschichte)/u, hint: 'a sentence about who reported the news is not news — delete it' },
    { rule: 'filler', re: /^(?:Das heißt|Mit anderen Worten|Kurz gesagt)[,:]/u, hint: 'filler sentence that repeats the one before — delete it or add a new fact' },
  ],

  // A subordinate clause standing alone as a sentence.
  fragmentRe: /^(?:Weil|Dass|Obwohl|Damit|Während|Nachdem|Bevor)\s[^,]*[.!]$/u,
  splitAfterShortNumber: false, // "am 21. November" is not a sentence end

  stop: new Set(('aber alle allen auch aus bei bis dann dass dem den denn der des deshalb die dies diese diesem diesen dieser ' +
    'doch dort durch eine einem einen einer eines für gegen haben hat hatte heute hier ihre ihren ihrer immer jetzt kann können ' +
    'mehr mit muss müssen nach nicht noch nun oder ohne schon sehr sein seine seinen seiner sich sind über und unter viel viele ' +
    'vom von vor war weil wenn werden wie wird wollen will zum zur zwischen jahr jahre jahren menschen neue neuen neuer sagt sagen gesagt gibt geben macht machen gemacht')
    .split(' ').map(w => w.slice(0, 5))),
  skipCapitalizedInRepeats: false, // every German noun has a capital

  // Vocabulary entry rules (returns a hint or null).
  checkVocab(v) {
    if (/^(?:noun|Nomen|名詞)$/i.test(v.pos || '') && !/^(?:der|die|das)\s/.test(v.base || '')) {
      return `noun "${v.word}": the dictionary form must start with der / die / das and give the plural, e.g. "die Regierung, -en"`;
    }
    return null;
  },
  vocabFormat: `"base": dictionary form. Nouns ALWAYS with article and plural ("die Regierung, -en"; "das Gesetz, -e"; no plural: "die Polizei (kein Pl.)"). Verbs as infinitive; add the Perfekt form for irregular verbs ("steigen (ist gestiegen)"); separable verbs as one word ("ankündigen").`,
  quizGrammar: 'article and case endings, verb position, Perfekt helper verb (haben / sein), prepositions',
};
