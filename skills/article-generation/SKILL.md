# Article Generation Skill

## Purpose
Generate a Japanese language learning article from real current news. The article must match the user's JLPT level precisely, use varied topics, and feel like an engaging news article written for a language learner.

## Topic Diversity — CRITICAL
The app generates articles daily. Every article MUST cover a genuinely different subject:

### What "different" means:
- A different industry, event, person, or phenomenon
- NOT the same topic with slightly different numbers (e.g., two articles about GDP growth = bad)
- NOT two articles about the same country's economy in a row

### Topic rotation strategy:
1. Check the user's configured topics list — treat these as **categories to rotate through**
2. If the last article was about politics, pick technology or culture next
3. If the last article was about Japan, pick a different region next
4. Within each category, find a **specific, interesting story** — not a generic overview

### Good topic variety examples:
- Monday: new bullet train route announced in Japan (technology/japan)
- Tuesday: German football team wins championship (sports/germany)
- Wednesday: popular ramen chain opens in New York (food/us)
- Thursday: Kyoto temple restoration completed (culture/japan)
- Friday: German startup raises funding for AI translation (startups/germany)

### Bad topic variety (what to AVOID):
- Japan's economy grew 2% → Japan's GDP forecast → BOJ interest rates → Nikkei index rises
- All articles about finance/economy, just with different numbers

## Article Structure

### 1. Title
- Short, clear, specific to the news story
- Should make the reader curious about the content

### 2. Summary (1 short sentence, max 80 characters / 12 words)
- Plain text, NO [NEW] or [REVIEW] markers
- Must fit on 2 lines on a small phone screen — keep it SHORT
- Max 80 characters total, max 12 words
- Example good length: "Tōkyō no atarashii densha ga kyō kara hashirimasu."
- Example too long: "Nihon no seifu wa atarashii keizai keikaku wo happyō shite, kokumin ni ōkii eikyō wo ataeru to iimashita."

### 3. Main Body (target word count from config)
- 8-12 short paragraphs
- Each paragraph: 2-3 sentences max
- Tell the news story with specific details (names, places, numbers)
- Make it interesting — not a dry report

### 4. Grammar Points (1-2 per article)
- Highlight a grammar pattern used naturally in the article
- Pattern, level, explanation, 2-3 example sentences

## JLPT Level Control — STRICT ENFORCEMENT

This is the most important quality dimension. An N3 article should feel achievable for an N3 student.

### Level determines EVERYTHING:
- **Vocabulary**: ONLY use words at or below the user's level
- **Grammar**: ONLY use patterns at or below the user's level
- **Sentence length**: Shorter for lower levels
- **Topic complexity**: Simpler angles for lower levels

### N5 (Absolute Beginner):
- **Vocabulary**: ~800 most basic words only. Things, people, places, basic actions
- **Grammar**: X wa Y desu. X ga arimasu/imasu. Basic particles only (wa, ga, wo, ni, de)
- **Sentences**: 5-8 words max. Subject-Object-Verb. No subordinate clauses
- **Topics**: Very concrete, everyday — food, weather, places, simple events
- **Tone**: Simple statements of fact. "Tōkyō ni atarashii mise ga arimasu."

### N4 (Elementary):
- **Vocabulary**: ~1,500 words. Adds common verbs, adjectives, basic abstract concepts
- **Grammar**: te-form, ~tai desu, ~to omoimasu, ~kara/node, ~toki, comparisons
- **Sentences**: 8-12 words max. Can connect two ideas with te-form or kara
- **Topics**: Everyday events, simple news, sports results, weather events
- **Tone**: Can express opinions simply. "Ōku no hito ga tanoshinde imasu."

### N3 (Intermediate):
- **Vocabulary**: ~3,750 words. Adds news vocabulary, emotions, abstract concepts
- **Grammar**: ~ni yoru to, ~ni tsuite, passive (~rareru), ~kamoshirenai, ~hazu, ~yō ni, ~ni taishite
- **Sentences**: 10-15 words max. Can use one subordinate clause
- **Topics**: Current events, social trends, technology — but explained simply
- **Tone**: Informative like NHK Easy News. Can discuss causes and effects
- **FORBIDDEN**: N2/N1 grammar, business/academic jargon, compound sentences with 3+ clauses

### N2 (Upper Intermediate):
- **Vocabulary**: ~6,000 words. Adds formal vocabulary, specialized terms
- **Grammar**: ~ni oite, ~wo motte, ~ba~hodo, ~ni kagirazu, ~to tomo ni
- **Sentences**: 15-20 words max
- **Topics**: Can handle complex news stories with nuance

### N1 (Advanced):
- **Vocabulary**: Full range
- **Grammar**: Literary patterns, formal/written Japanese
- **Sentences**: No practical limit
- **Topics**: Any complexity

### HARD RULES for level enforcement:
1. Before writing, mentally list vocabulary you'll use — verify ALL are at or below the target level
2. If a topic requires N1/N2 vocabulary and the user is N3, **simplify the angle**:
   - Instead of "quantitative easing monetary policy" → "the bank changed how it gives money"
   - Instead of "bilateral diplomatic negotiations" → "the two countries talked about a problem"
3. If a news story is too complex for the level, pick a simpler aspect of it
4. NEVER teach N2/N1 words as [NEW] vocabulary to an N3 student

## Vocabulary Markers

### [NEW] — First encounter with a word
- Mark on first use in the body text: `[NEW] keizai`
- Only for genuinely useful vocabulary at the user's JLPT level
- Target count: exact number from config (usually 10-15)

### [REVIEW] — Previously learned word
- Mark on first use: `[REVIEW] shigoto`
- For words the user has seen before (from known words list)

### NEVER mark with [NEW] or [REVIEW]:
- Particles (wa, ga, wo, no, ni, de, to, mo, ka)
- Copulas (da, desu, deshita)
- Basic verbs everyone knows (suru, aru, iru, naru, iku, kuru)
- Pronouns and demonstratives
- Numbers, counters, dates
- Proper nouns (people, companies, countries, cities)
- English loanwords that are obvious (terebi, konpyūtā)

## Tone and Style
- Informative but accessible — like NHK Easy News
- Use specific details from the real news (names, places, numbers)
- Not condescending, not academic
- Each article should feel like reading a short news story, not a textbook exercise

---

## Few-Shot Examples — Study These Carefully

These annotated examples show EXACTLY what a correct article looks like at each level.
Copy their sentence length, grammar complexity, and vocabulary depth for your own articles.

---

### N5 Example Article (Absolute Beginner)

**Title:** Tōkyō ni atarashii mise ga arimasu

**Summary:** Tōkyō ni atarashii rāmen no mise ga arimashita. *(31 chars, 8 words — good)*

**Body:**
> Tōkyō ni [NEW] rāmen no mise ga arimasu. Sono mise wa [NEW] ōkii desu. Mainichi takusan no [NEW] hito ga kimasu. Mise no namae wa "Ichiban" desu. [NEW] Gohan mo arimasu. Totemo [NEW] oishii desu.

**✓ Correct N5 patterns:**
- Sentence length: 4–7 words each — CORRECT
- Grammar only: "X wa Y desu", "X ga arimasu", "X ga imasu" — CORRECT
- [NEW] words: rāmen (N5 loanword, useful), ōkii (N5 adj), hito (N5 noun), gohan (N5 noun), oishii (N5 adj) — CORRECT
- Particles used: wa, ni, no, ga — basic N5 particles only — CORRECT

**✗ What to REJECT for N5:**
- `[NEW] mise ga ninki desu` → "ninki" is N4, too advanced
- `Hito ga tabete iru` → te-form "tabete iru" is N4 grammar
- `Mise wa kirei de, oishikute, yasui desu` → chained adjectives with te-form = N4

---

### N4 Example Article (Elementary)

**Title:** Ōsaka de atarashii densha ga hashirimasu

**Summary:** Ōsaka ni atarashii chikatetsu no eki ga dekimashita. *(50 chars, 8 words — good)*

**Body:**
> Ōsaka de [NEW] chikatetsu no atarashii [NEW] eki ga dekimashita. Kono eki wa [NEW] benri de, takusan no hito ga [REVIEW] tsukaimasu. [NEW] Mainichi yaku goman-nin ga koko wo [NEW] riyō suru to iwarete imasu. Seifu wa "kore wa [NEW] taisetsu na [NEW] keikaku desu" to iimashita. Rainen mo atarashii [NEW] rosen ga dekiru yotei desu.

**✓ Correct N4 patterns:**
- Sentence length: 8–12 words — CORRECT
- Grammar: te-form ("benri de"), ~to iimashita (reported speech), ~yotei desu (plan/schedule) — CORRECT N4 patterns
- [NEW] words: chikatetsu (N4), eki (N4/N5), benri (N4 adj), riyō (N4 verb), taisetsu (N4 adj), keikaku (N4 noun), rosen (N4 noun) — CORRECT
- [REVIEW]: tsukaimasu — a previously seen word, correctly marked for review

**✗ What to REJECT for N4:**
- `Eki no kōzō wa fukuzatsu desu` → "kōzō" (structure) is N2, "fukuzatsu" is N3 — both too advanced
- `Seifu ni yoru to, keizai ni ōkii eikyō ga aru kamoshirenai` → "~ni yoru to" and "~kamoshirenai" are N3 grammar
- `Kōtsū no ryōmen ni merito ga aru` → "ryōmen", "merito" are N2 level

---

### N3 Example Article — German Economics Topic

This is the most important example. Shows how to handle a COMPLEX news topic (economics, politics)
at N3 level without slipping into N2/N1 vocabulary.

**Situation:** News story is about the German government cutting the national budget.

**Title:** Doitsu no seifu ga okane no keikaku wo kaemashita

**Summary:** Doitsu wa kuni no okane no tsukaikata wo kaeta to happyō shimashita. *(63 chars, 11 words — good)*

**Body:**
> Doitsu no [NEW] seifu wa, kuni no [NEW] yosan wo [NEW] herasu to happyō shimashita. [NEW] Keizai no senmon-ka ni yoru to, kono [NEW] kettei wa taisetsu da sō desu. Seifu wa [NEW] kyonen yori mo sukunai okane de [NEW] kōkyō no [NEW] sābisu wo [NEW] iji suru [NEW] hitsuyō ga aru to itte imasu. Kono koto ni [NEW] hantai suru hito mo imasu. "Kore wa [REVIEW] shimin ni totte [NEW] muzukashii [NEW] jōkyō desu" to, aru [NEW] seijika ga iimashita. Rainen no [NEW] yotei wa mada [REVIEW] wakarimasen.

**✓ Correct N3 patterns:**
- Sentence length: 10–15 words — CORRECT
- Grammar: `~ni yoru to` (according to, N3), `~da sō desu` (hearsay, N3), `~ni totte` (for/to someone, N3), `~hitsuyō ga aru` (need to, N3), `~ni hantai suru` (oppose, N3) — ALL correct N3 patterns
- [NEW] words (all N3 or below): seifu (government, N3), yosan (budget, N3), herasu (reduce, N3), keizai (economy, N3), kettei (decision, N3), kyonen (last year, N4), kōkyō (public, N3), sābisu (service, N4 loanword), iji (maintain, N3), hitsuyō (necessity, N3), hantai (opposition, N3), muzukashii (difficult, N4), jōkyō (situation, N3), seijika (politician, N3), yotei (plan/schedule, N4)
- [REVIEW] words: shimin (citizen), wakarimasen — previously learned, correctly reused

**Topic simplification applied — what was REJECTED:**
- `ryōteki kanwa seisaku` (quantitative easing) → replaced with `okane no keikaku` (money plan) — N3 simplification ✓
- `zaisei akaji` (fiscal deficit) → replaced with `okane ga tarinai` (not enough money) — N4 simplification ✓
- `kōzō kaikaku` (structural reform) → replaced with `kaeru` (change) — avoids N1 compound ✓
- `~ni oite wa` (N2 grammar) → replaced with `~ni tsuite` (N3) or rephrased ✓
- `~to tomo ni` (N2 grammar) → replaced with `~to issho ni` (N4) ✓
- `~ni kagirazu` (N2 grammar) → avoided entirely ✓

**✗ What would make this article fail at N3:**
- Using "zaisei" (fiscal, N1), "akaji" (deficit, N2), "kanwa" (easing, N1) — ALL N2/N1
- Writing sentences with 3+ clauses: `Seifu wa herashite, shimin wa okotte, seijika wa hantai shite, mondai ga ōkiku natta` — too complex
- Using `~ni oite wa` or `~wo fumaete` — N2 grammar patterns
- Marking "okane", "kuni", "hito" as [NEW] — these are N5 words everyone knows

---

### Topic Simplification Quick-Reference

When a news story uses complex terminology, simplify to the student's level using these patterns:

| Complex Term (Too Hard) | N3 Simplification | N4 Simplification |
|-------------------------|-------------------|-------------------|
| ryōteki kanwa (quantitative easing) | okane no keikaku (money plan) | okane wo ōku suru (increase money) |
| gaikō kōshō (diplomatic negotiations) | futari no kuni ga hanashimashita (two countries talked) | kuni to kuni no hanashi (country-to-country talk) |
| infure (inflation, economic sense) | mono no nedan ga agatta (prices went up) | mono ga takai ni natta (things got expensive) |
| sōgō-teki na (comprehensive) | iroiro na (various kinds of) | takusan no (many) |
| kōzō-teki na mondai (structural problem) | ōkii mondai (big problem) | naoshi ni kuii mondai (hard-to-fix problem) |
| bilateral (N2 concept) | futatsu no kuni (two countries) | futatsu no kuni (two countries) |
