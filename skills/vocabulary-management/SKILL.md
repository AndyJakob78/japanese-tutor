# Vocabulary Management Skill

## Word Status Lifecycle
```
new → learning → known → mastered
```

### Promotion Rules
- **new → learning**: Word appears in an article (automatically)
- **learning → known**:
  - Seen in 5+ articles AND
  - Tested correctly 3+ times AND
  - Used by user in quiz/context correctly 2+ times
- **known → mastered**:
  - All "known" criteria met AND
  - Passed spaced repetition reviews at: 1 day, 3 days, 7 days, 14 days, 30 days

### Demotion Rules
- **known → learning**: Failed 2 consecutive reviews
- **mastered → known**: Failed a review after 30+ days

## Spaced Repetition Schedule
| Review # | Interval | After becoming... |
|----------|----------|-------------------|
| 1 | 1 day | "known" |
| 2 | 3 days | Review 1 passed |
| 3 | 7 days | Review 2 passed |
| 4 | 14 days | Review 3 passed |
| 5 | 30 days | Review 4 passed → "mastered" |

## Article Vocabulary Budget
- **New words**: 10-15 per article (configurable, minimum 10)
- **Review words**: 15-25 per article (from "learning" status)
- **Known words**: Use freely, no limit
- **Total unique tracked words per article**: ~30-40

## Word Selection for New Articles
Priority for new words:
1. Words directly from the news content being discussed
2. Words related to the user's configured topics
3. Words at the user's current JLPT level
4. Words that connect to previously learned words (same topic/category)

Priority for review words:
1. Words closest to their next spaced repetition review date
2. Words with lowest correct-test ratio
3. Words the user hasn't seen in the longest time

## JLPT Level Boundaries
- Only introduce words at or below the user's configured level
- Exception: proper nouns and katakana loanwords that are self-explanatory
  (e.g., "infura" for infrastructure, "samitto" for summit)
