# Japanese Language Learning Article Generator

## Project Purpose
Generate Japanese language learning articles from real current news. All output in Hepburn romaji with macrons. Target level: JLPT N4-N3.

## Agent Pipeline
1. Topic Selection → reads skills/news-sourcing/SKILL.md
2. News Search → reads skills/news-sourcing/SKILL.md
3. Article Generation → reads skills/article-generation/SKILL.md + skills/romaji-standards/SKILL.md
4. Vocabulary Extraction → reads skills/vocabulary-management/SKILL.md
5. Quiz Generation → reads skills/quiz-generation/SKILL.md

## Conventions
- All Japanese text: Hepburn romaji with macrons (ā, ī, ū, ē, ō)
- Never output hiragana, katakana, or kanji in user-facing article text
- Kanji/kana stored in database for reference only
- New words per article: 10-15 (configurable, minimum 10)
- Reuse ratio: 60-70% of vocabulary from previously learned words
