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

## One set of screens (app 1.6): the Japanese shape and per-language settings

From app 1.6 on, German and English use the same screens as Japanese. The app
then sends two headers:

```
X-Learning-Language: de      (or en)
X-Client-Api: 2
```

With `X-Client-Api: 2` the same URLs answer in the shape of the Japanese API,
so the shared screens can read them. Without it (app 1.5) the neutral shape
stays. Both come from the same stored data.

| File | What it does |
|---|---|
| `shape.js` | stored article / word / quiz / statistics → Japanese field names (`title_romaji`, `meaning_en`, `jlpt_level`, whole-number word ids) |
| `settings.js` | the settings of one language: defaults, saving, and what one article is written with |
| `server.js` | the second set of routes (`v2`), incl. `GET` / `PUT /api/config` for this language |
| `store.js` | gives every word a number (`num_id`), tests with a mode (`typed` / `sentence` / `choice`) |

Settings are stored as ONE config record per learner and language
(`settings_de`, `settings_en`). Article length, sentence length and the number
of new words follow the level until the learner changes them.

How each setting reaches the article:

| Setting | Effect |
|---|---|
| Level | level rules of `languages/*.js` |
| Article length | target length in the writer prompt and the length check |
| Max sentence length | extra line in the level rules and the sentence check |
| New words per article | range for `[NEW]` words; 0 = none, with more review words |
| Reuse ratio | how many words from earlier articles are offered (1–5) |
| Quiz questions | 3–15, split over content / vocabulary / grammar |
| News timeframe | search window (the longest choice keeps the 10-day window) |
| Topics | rotated, one per article |
| Regions | where the news comes from; none = the home region of the language |

No setting adds a Claude call.
