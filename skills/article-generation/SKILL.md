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
