# German and English articles (prototype)

The same idea as the Japanese pipeline, for Japanese speakers who learn
German or English. Nothing here is connected to the app or the database yet.

**Chain:** news → writer (article, Japanese translation, vocabulary, one
grammar note) → code check → reviewer (gets the code-check findings) → code
check again → quiz. Three Claude calls per article, plus one quiz repair call
only when the quiz check finds a problem.

**Levels:** `A1-A2` (one beginner level), `B1`, `B2`.

| File | What it is |
|---|---|
| `languages/de.js`, `languages/en.js` | Level rules (text for writer and reviewer) and the code-check patterns |
| `lint.js` | The code check, the automatic repairs and the quiz check |
| `prompts.js` | Writer, reviewer, quiz and news-search prompts |
| `generate.js` | The chain |
| `run.js` | Try it from the terminal; results go to `out/` |
| `../test/multilang-lint.test.js` | Tests (`npm test`) |

```bash
node multilang/run.js search de "science"   # find a news story → out/news-de.json
node multilang/run.js de A1-A2              # one level
node multilang/run.js en all                # all three levels from the same story
```

**Rule for problems a reader reports:** add one line to `phrases` in the
language file (or a rule in `lint.js`) and one case in the test file.

**Not built yet:** word lists per level (today the writer decides which
words are new), database storage, the API routes, the app screens.
