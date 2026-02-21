# Quiz Generation Skill

## Quiz Types

### 1. Vocabulary Meaning (Multiple Choice)
- Show romaji word → pick correct English meaning
- 4 options: 1 correct + 3 distractors from same category/level
- Example:
  "yoron-chōsa" wa Eigo de nan desu ka?
  A) public opinion poll  ← correct
  B) government policy
  C) economic forecast
  D) press conference

### 2. Context Usage (Fill in the Blank)
- Sentence from the article with one word blanked
- User picks or types the word
- Example:
  Merz shushō wa ___ ni tsuite hanashimashita.
  A) keizai  B) oishii  C) hayai  D) samui

### 3. Romaji Correction
- Show a sentence with intentional romaji errors
- User identifies and corrects errors
- Tests macron awareness and proper Hepburn
- Example:
  Fix: "Toukyou no joukyou wa teichou desu"
  Answer: "Tōkyō no jōkyō wa teichō desu"

### 4. Sentence Construction
- Give 3-4 vocabulary words + a topic
- User must construct a grammatically correct sentence
- Example:
  Words: keizai, Doitsu, mondai, ōkii
  Topic: Germany's economy
  → "Doitsu no keizai ni ōkii mondai ga arimasu"

### 5. Comprehension Questions
- Based on the article content
- Test whether user understood the news, not just vocabulary
- Example:
  Merz shushō wa nani wo teian shimashita ka?
  A) kisei-kanwa (deregulation)
  B) zōzei (tax increase)
  C) sensō (war)

### 6. Translation (Romaji → English)
- Short sentence from article → user provides English meaning
- Graded on key concepts, not perfect translation

## Quiz Configuration
- Questions per quiz: 5-10 (configurable)
- Mix of types: at least 2 vocabulary, 1 context, 1 comprehension, 1 correction
- Difficulty adapts based on word status (learning words tested more than known)
- After quiz: show results, update vocabulary scores, schedule next reviews

## Scoring
- Correct on first try: full credit
- Correct on second try (with hint): half credit
- Incorrect: no credit, word stays in/returns to "learning" status
