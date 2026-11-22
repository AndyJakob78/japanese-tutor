# Progress screen: how it decides what to show

Status: design, agreed as a mockup on 2026-11-22. Not built yet.
Applies to all three courses (Japanese, German, English). Levels are N5–N1 for
Japanese and A1–A2, B1, B2 for German and English.

The screen answers three questions, in this order:

1. How long until my next level?
2. What should I do now?
3. Am I keeping it up?

Everything below is plain arithmetic on data the app already stores, plus one
new daily record (see "What has to be stored"). No AI call is involved, so the
screen opens instantly and article generation is not slowed down.

---

## 1. Time to the next level

### Progress in the current level

```
progress = words of the level list the learner knows / words on the level list
```

- **Level list:** all words of the learner's level and the levels below it
  (for N4: the N5 and N4 lists together).
- **Knows:** the word has status Known or Mastered. A word only gets there by
  being typed from memory or used correctly in an own sentence on two
  different days. Multiple choice never counts.

### Pace

```
pace = words that became Known in the last 28 days / 4      (words per week)
```

Four weeks smooth out a single busy or lazy week.

### Estimate

```
weeks left = words still missing on the level list / pace
```

How it is shown:

| Time left | Shown as |
|---|---|
| under 14 days | days ("9 days") |
| 2 to 10 weeks | weeks ("6 weeks") |
| longer | months ("7 months"), with the month it lands in ("around June 2027") |
| over 24 months | "more than 2 years" |

### When there is no estimate yet

An estimate from too little data would be wrong and discouraging. The screen
shows "Review for N more days to see your estimate" until both are true:

- activity on at least 10 of the last 28 days, and
- at least 10 words became Known in the last 28 days.

### The three pace buttons

Each button recalculates the estimate with a different pace. The learner's own
numbers are used, so the buttons are honest for that person.

| Button | Pace used |
|---|---|
| As now | the measured pace above |
| Daily review | 10 typed words every day × the share of the learner's typed answers that are right × ½ (a word needs two right days to become Known). Until 20 typed answers exist, 70 % right is assumed |
| +1 article a day | the same with 15 typed words a day: one more article brings its words into review, and reading alone does not make a word Known |

A button is hidden when it would not be faster than "As now".

### What the estimate does not cover

It measures vocabulary. It says nothing about grammar or listening, and it is
not a promise about passing an exam. The screen says "N3 vocabulary" in the
small print.

---

## 2. "Do this next"

One card, one action. The rules are checked from top to bottom and the first
one that applies wins.

| # | When | Card says | Opens |
|---|---|---|---|
| 1 | Back after 7 or more days without activity | "Welcome back. Start with 5 easy words · 2 min" | Daily Review with 5 words the learner got right before |
| 2 | 5 or more words are due for review | "Review N words · M min" (at most 10 words; 15 seconds per word) | Daily Review |
| 3 | An article was created in the last 14 days and not opened | "Read your new article · 4 min" | that article |
| 4 | An article was read in the last 3 days and its quiz was not taken | "Take the quiz · 2 min" | that quiz |
| 5 | A mistake pattern came up 3 or more times in 30 days and was not practised in the last 3 days | "Practise wa or ga · 5 sentences" | Build Sentences with that pattern as the focus |
| 6 | 10 or more words are still Learning and were never typed | "Type 10 words from memory · 3 min" | Daily Review with those words |
| 7 | A weekly goal is at 60 % or more, but not done | "Finish this week's goal: 12 words to go" | the matching exercise |
| 8 | None of the above | "Read something new" | the New Article form |

Why this order: due words come first because a word reviewed late is often
forgotten and the earlier work is lost. Reading comes before practice because
a waiting article is finished work the learner has not used yet. New material
comes last, because adding words while old ones are waiting slows the level.

### The line under the action

The card always gives one reason. The first that applies:

1. **Time gained:** "Brings N3 about 2 days closer."
   `days gained = words this action is expected to move to Known / pace per day`
   A word counts as "expected" when one more correct typed answer today would
   make it Known, multiplied by the learner's share of right typed answers.
   Shown only when the result is at least 1 day.
2. **Streak:** "Keeps your 5-day streak." Shown when nothing was done today
   and the streak is 3 days or longer.
3. **Goal:** "Completes this week's goal."
4. Otherwise a plain reason ("They are due today.").

Reasons 1 and 2 are combined when both apply.

---

## 3. Your weak spot

Shown only when a mistake pattern has come up at least 3 times in the last
60 days. Patterns come from the corrections in Build Sentences, which are
already filed under fixed names (wa or ga, te-form, case after "mit", ...).

- **Which one:** the most frequent pattern; if two are equal, the more recent.
- **Text:** the pattern, how often it happened, and one example of the
  learner's own (what was written, what is right).
- **Link:** opens Build Sentences with that pattern as the focus.
- A pattern disappears from the card after 5 correct sentences in a row that
  use it, or when it has not come up for 60 days.

---

## 4. Streak

- **A day counts** when the learner did at least one of: read an article,
  finished a Daily Review, finished a quiz, checked a sentence.
- **Days follow the phone's own time zone**, not the server's.
- The week row shows Monday to Sunday with a tick per counted day. Today has
  a dashed ring until something is done.
- Under the number, the next reward: "2 more days for the 7-day badge".
- A missed day ends the streak. There is no repair or freeze.

---

## 5. "This week you pulled N3 X days closer"

```
days closer = estimated arrival date last Monday − estimated arrival date now
```

- Positive: shown in green ("6 days closer").
- Zero or negative: the line changes to "N3 moved 4 days away. One review
  today turns that around." It is never hidden, so the number stays honest.
- Not shown while there is no estimate.

---

## 6. Weekly goals

Three goals, Monday to Sunday.

| Goal | Counts |
|---|---|
| Read articles | articles opened and scrolled to the end |
| Type words from memory | right typed answers in Daily Review |
| Write sentences | sentences checked in Build Sentences |

**How high the goals are:** the learner's weekly average of the last 4 weeks,
plus 10 %, rounded to a friendly number. Never below 3 articles, 30 typed
words and 3 sentences; never above 10, 150 and 15. A new learner starts at
the lowest values.

Each goal shows what is left in plain words ("12 to go, one review does it").
A finished goal turns green and says "Done". Goals do not carry over.

---

## 7. Badges

Earned once, kept forever. Locked badges are shown grey with what they need.

| Group | Badges |
|---|---|
| Levels | one per completed level |
| Streak | 7, 30 and 100 days |
| Words typed | 100, 500 and 1,000 right typed answers |
| Articles | 25, 100 and 250 articles read |

---

## What has to be stored

Most numbers already exist (word status, test counts, article read dates,
mistakes). New:

| New record | Why |
|---|---|
| One line per learner, language and day: articles read, typed answers right, sentences checked, words that became Known | streak, week row, weekly goals, pace, "days closer" |
| The date a word became Known | pace over the last 28 days |
| The estimate as it stood each Monday | "days closer this week" |
| Earned badges with their date | badges |
| The phone's time zone, sent with each request | days that match the learner's day |

Existing learners start with an empty daily record. For the days before it,
the dates on which articles were read are used, so the streak and the
reading goal are right from the first day. Typed words and sentences are
counted from the day the server is updated. The level progress is correct
from the first day, because it is counted from the stored words.

## Known limits

- German word levels come from a frequency list, so the German estimate is
  rougher than the Japanese and English ones.
- A learner who only reads and never types gets no estimate. That is on
  purpose: the screen then says what to do to get one.
- Words the learner knows from outside the app are not counted until they
  have been typed here.
