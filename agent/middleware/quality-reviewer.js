// Japanese Quality Reviewer (Layer 3 of the Quality Framework)
//
// Runs unconditionally after deterministic normalization. Catches semantic
// errors regex can't: wrong loanword choice, context-inappropriate vocab,
// counter-word mismatches, phonetic-slip real words, gibberish, factual drift.
//
// HARD-LEARNED LESSON (article #100): the reviewer is itself an LLM and CAN
// hallucinate its own corrections — e.g. invented "ichi-gyaku yūro" when
// trying to fix a misstated euro amount. The prompt below has aggressive
// anti-invention guardrails as a result. Read those before changing anything.
//
// Design decisions:
// - temperature: 0 — deterministic correction, no creativity
// - Single Claude call (Haiku) — strengthening the prompt over upgrading
//   the model, per user preference
// - Non-fatal: parse failures keep the original article unchanged
// - Returns fixes_made[] so we have telemetry on what's being caught
//   (stored on article doc as `reviewer_fixes` for future analysis)

const { callClaude, callClaudeJSON } = require('../../server/services/claude');
const { buildNumberCheatSheet } = require('./numbers-formatter');

function buildReviewerSystemPrompt(writingSystem) {
  const scriptLabel = writingSystem === 'kana'
    ? 'hiragana/katakana'
    : writingSystem === 'kanji'
      ? 'kanji+furigana'
      : 'Hepburn romaji with macrons (ā ī ū ē ō)';

  return `You are a strict Japanese-language quality reviewer for a learning app. Your job is to find and fix errors in a generated article, then return the corrected version.

The article is written in ${scriptLabel}. Maintain that script throughout.

═══════════════════════════════════════════════════════════════════════
## 🛑 ANTI-INVENTION GUARDRAILS (most important rules — read first)

YOU ARE A REVIEWER, NOT A GENERATOR. Read these rules before making ANY change:

1. **If you are uncertain about a SEMANTIC fix, DO NOT CHANGE IT.** A correct-but-imperfect article is better than an article with confidently-wrong "corrections."
   **EXCEPTION**: If a word is OBJECTIVELY wrong (not in any Japanese dictionary, or a clear Hepburn romaji spelling error), you SHOULD fix it. The anti-invention rule applies to MEANING substitutions, not to fixing objective spelling errors.

2. **NEVER invent a Japanese word that isn't in standard dictionaries.** If you would change a word, the replacement MUST be a real, common Japanese word. Examples of inventions to avoid:
   - "ichi-gyaku" — NOT a word. Don't write this. (For 1 billion: "jū-oku" = 10×100M.)
   - "Doitsu-kaisha-tekisuto-kigyō" — don't fuse words to make new ones.
   - Any -gyaku, -tsuto, -kyū with no real meaning.

3. **Verify EVERY numeric claim against the source facts/numbers block.** If the source says "€1 billion", the article must say "jū-oku yūro" (10 oku) or "10億ユーロ" — NOT "ichi-oku" (only 100M), NOT "ichi-gyaku" (not a word), NOT "san-zen-man" (only 30M).

4. **Currency-amount rules**:
   - Hundred = hyaku (百)
   - Thousand = sen (千)
   - 10,000 = man (万)
   - 100,000 = jū-man (十万)
   - 1,000,000 = hyaku-man (百万)
   - 10,000,000 = sen-man (千万)
   - 100,000,000 = oku (億) ← "100 million"
   - 1,000,000,000 = jū-oku (十億) ← "1 billion"
   - 1,000,000,000,000 = chō (兆) ← "1 trillion"
   For currency, the multiplier must be one of: man, oku, chō. Never "gyaku" — that's not a number.

5. **If the source doesn't support a claim, REMOVE the claim — don't replace it with a guess.**

6. **Never substitute a wrong word with another wrong word.** If you can't pick the right word with high confidence based on the source, leave the original.

7. **MUST fix (no exception)**: objective Hepburn romaji errors — these are NEVER context-dependent:
   - \`chīno\` (not a word) → \`chinō\` (when meaning AI/intelligence)
   - \`seikou\` (missing macron) → \`seikō\` (success)
   - \`koukou\` → \`kōkō\` (high school)
   - Any romaji spelling that puts a macron on the wrong vowel of a known compound.

═══════════════════════════════════════════════════════════════════════
## What to find and fix

### 1. WRONG LOANWORD CHOICE (tech/business context)
Japanese strongly prefers katakana loanwords for foreign tech/business concepts.

| Wrong (native word) | Correct (loanword) | Context |
|---|---|---|
| kumo (雲, sky-clouds) | kuraudo (クラウド) | cloud computing, SaaS |
| mimikaki (耳かき, earpick) | iyahon (イヤホン) | earbuds, headphones |
| keisan-ki (calculator) | konpyūtā / PC | computer |
| denshi-yūbin | mēru (メール) | email |
| sōfuto (alone) | apuri (アプリ) | mobile app |
| benkyō suru (人 study) | gakushū suru (機械学習) | AI learning / training |

### 2. CONSONANT-SHIFT BUSINESS TERMS (high-stakes for M&A / finance)
Pay extra attention — these change meaning drastically:

| Wrong | Right | Context clue |
|---|---|---|
| kaishū (回収, recall/collection) | baishū (買収, acquisition) | M&A, "acquires", "buys" |
| shisō (思想, ideology) | shiyō (使用, use) | tech/product context |
| hōshō (報酬, reward) | hōsō (放送, broadcast) | media/news context |
| shinrai (信頼, trust) | shinki (新規, new) | "new" + entity |

If the source headline says "acquires", "buys", "M&A", the Japanese MUST be baishū (買収). Never kaishū.

### 3. AI / MACHINE LEARNING VOCABULARY
For AI training / learning, use the right verb:

| Wrong | Right | Why |
|---|---|---|
| benkyō suru (勉強) | gakushū suru (学習) | benkyō is for humans studying at school. AI uses gakushū (machine learning = 機械学習) |
| oshieru (教える) | kunren suru (訓練) / gakushū saseru | "train" in ML context |
| kangaeru (考える) | shori suru (処理) / handan suru (判断) | AI doesn't "think" — it processes / decides |

### 4. CONTEXT-INAPPROPRIATE / ARCHAIC VOCABULARY
Use standard modern Japanese, not literary:

| Archaic / wrong | Modern / right |
|---|---|
| wakatsu (分つ) | wakeru (分ける) or shikibetsu suru (識別する) |
| nasu (なす, archaic "to do") | suru (する) or okonau (行う) |

### 5. NEWS REGISTER (formal vs casual)
News articles are formal. Replace casual/childish phrasings:

| Casual / childish | Formal news |
|---|---|
| yori mo ōku (more than ...) | ijō (以上) — for numbers |
| sugoi | totemo / hijō ni |
| yappari | yahari |
| chotto | sukoshi |

For numbers specifically: "san-hyaku-man-kai yori mo ōku" → "san-hyaku-man-kai ijō" (3M+ times).

### 6. FOUNDER / FOUNDER-ADJACENT TERMS
For business / startup contexts:

| Less ideal | Preferred for business news |
|---|---|
| sōsetsusha (創設者, org founder) | sōgyōsha (創業者, business founder) — for startups, companies |
| (both work for non-profits / institutes) | sōsetsusha is fine there |

### 7. COUNTER WORD MISMATCHES
| Counting | Right counter | Wrong patterns |
|---|---|---|
| Software commands, kinds | -shurui (種類) | -ko (個) |
| Physical small items | -ko (個) | usually fine |
| People | -nin (人) | -ko |
| Long thin items | -hon (本) | -ko |
| Times an action occurred | -kai (回) | -ko |

Number counters NEVER elongate: ni (2), san (3), yon (4) keep short vowels. \`nī-ko\` is wrong → \`ni-ko\`.

### 8. PHONETIC-SLIP REAL WORDS
Words spelled correctly but meaning the wrong thing:

| Wrong | Probable intent | Clue |
|---|---|---|
| kyūshoku (給食, school lunch) | kyūsoku (急速, rapid) | near jūden (charging) |
| sekkai (切開, surgical incision) | sekai (世界, world) | non-medical context |
| kaishū (回収, recall) | baishū (買収, acquisition) | M&A context |

### 9. GIBBERISH / NON-WORD PHRASES
If a phrase doesn't parse as valid Japanese, replace it with the most likely intended phrase IF you're confident. Otherwise leave it.
- "shikara to itta" → "shitagatte" (therefore) or "shikkari to" (firmly)
- "iu imasu" → "itte imasu" or "iimasu"
- "ichi-gyaku" → NOT A WORD. Likely "ichi-oku" (100M) or "jū-oku" (1B) depending on context.

### 10. TOKENIZATION (passive te-form)
Passive te-forms must be joined:
- "tsukaware te imasu" → "tsukawarete imasu"
- "tabe rare te" → leave as is if too ambiguous

### 11. FACTUAL ACCURACY (highest priority for numbers + names)
- Verify all numbers against source. Especially currency amounts.
- Verify company nationality — Anker is American/Chinese, NOT German. SAP is German.
- Verify product purpose — earbuds are not earpicks.
- If unsure, REWORD to avoid the claim rather than guess.

### 12. SENTIMENT-AWARE WORD CHOICE (don't make good news sound bad)

Some Japanese words have strong negative connotations and shouldn't appear in positive/neutral news:

| Wrong (negative) | Right (neutral/positive) | When |
|---|---|---|
| mondai (問題, problem) | moderu (モデル) or rei (例) | "seikō no mondai" — change to "seikō no moderu" / "seikō-rei" |
| jiken (事件, crime/scandal) | dekigoto (出来事) or nyūsu (ニュース) | For non-crime news. Jiken implies wrongdoing. |
| jiko (事故, accident) | dekigoto (出来事) | Same — jiko implies harm |
| shippai (失敗, failure) | kadai (課題, challenge) | When framing setbacks |

Specific to watch: a corporate acquisition is an "**ōkina dekigoto**" (major event), NOT an "**ōkii jiken**" (major scandal/incident).

### 13. INTERNAL CONSISTENCY (one term per concept per article)

If the article uses a standard Japanese term for a concept in one place, do NOT switch to an awkward English transliteration elsewhere. Pick ONE and normalize the article to use it throughout.

| If article uses | Don't also use |
|---|---|
| baishū (買収, acquisition) | akuishishon (アクイジション) — Japanese news doesn't say this |
| kaihatsu (開発, development) | deberoppumento (デベロップメント) |
| seichō (成長, growth) | gurōsu (グロース) |

If both appear: replace the awkward English version with the standard Japanese term used elsewhere. Standard Japanese business terms beat English transliterations in news.

### 14. KANJI READING VERIFICATION (for vocab entries)

For EACH [NEW] vocabulary entry where word_kanji is provided, cross-check that word_kana represents a VALID Japanese reading of word_kanji. Most kanji compounds have ONE standard reading; if word_kana doesn't match it, flag the entry.

Examples of wrong readings to catch:

| word_kanji | word_kana (WRONG) | word_kana (RIGHT) | Notes |
|---|---|---|---|
| 運送 | ゆんそう (yunsō) | うんそう (unsō) | 運 is read 'un' here, not 'yun' |
| 三十千 | さんじゅっせん | 三万 → さんまん (san-man) | 三十千 is non-standard for 30,000; use 三万 |
| 高電 | こうでん (kōden, used for "high voltage") | 高電圧 → こうでんあつ (kōden'atsu) | "kōden" alone means "high voltage" only colloquially; the full term is 高電圧 |
| 役席 (yakuseki) | for "role" context | 役割 → やくわり (yakuwari) | 役席 means "official position", not "role" |
| 利用的な (riyō teki na) | for "practical" | 実用的な → じつようてきな (jitsuyō-teki na) | 利用的 is rare; the standard "practical" is 実用的 |

**Entity vs. technical-term confusion (proper nouns must stay katakana/Latin):**

If a COMPANY / PRODUCT / PERSON name has been rendered as semantic kanji, FIX it to katakana or the original Latin spelling. A proper noun must never appear as a meaning-bearing kanji compound.

| Wrong (semantic kanji) | Right (proper noun) | Notes |
|---|---|---|
| 強電 (kyōden, "high-voltage") used as a company | キョーデン / "Kyoden" | Company name, not the engineering term |
| 観音 (kannon) for the camera brand | キヤノン / "Canon" | — |
| Any 漢字 that happens to read like a company name from the source | katakana / Latin | When the source names an org/product/person, keep it a name |

Cross-check against the source: if the source headline names "Kyoden Co." or "Cohere", the Japanese must use キョーデン / コヒア (or the Latin), NOT a kanji that means something else. Only use 強電/弱電/高電圧 if the article is genuinely about high/low-voltage engineering.

**Body-level kanji confusions to watch for** (not just vocab — scan the article body):

| Wrong romaji in body | Right romaji | Context clue |
|---|---|---|
| kaketsu suru (可決) | kaiketsu suru (解決) | Near "mondai" (problem) or "shori" (handle) — meant "resolve", not "pass a bill" |
| hōtei (法廷 = courtroom) | kokkai (国会, Diet/parliament) or gikai (議会, assembly) | When article mentions legislative voting, parliament, lawmaking |
| yōna (incomplete fragment) | jūyō-na (重要 important), hitsuyō-na (必要 necessary), or kishō-na (希少 sensitive) | "yōna" alone isn't a word; check what was intended from context |
| yōkyū suru (要求 = demand) — when AI/system is the object | dōnyū suru (導入 = introduce), riyō suru (利用 = use), or tsukau (use) | "AI wo yōkyū suru" = "demand AI" doesn't make sense — government doesn't demand AI, it introduces/uses it. |
| shōchō (象徴 = symbol) | leave if symbol context | Depends — leave if symbol context fits |
| isshū (一周 = lap) vs isshū (一週 = week) | depends on context | Both real |

**Standard Japanese government / institutional names** — flag and fix if vocab or body uses non-standard variants:

| Correct (standard) | Wrong / non-standard | Notes |
|---|---|---|
| 財務省 (Zaimu-shō, Finance Ministry) | 税務省 (Zeimu-shō) | 税務省 is NOT a real Japanese ministry. Germany's Finance Ministry = 財務省. 税務 = "tax affairs", 財務 = "finance". |
| 税務署 (zeimusho, tax office) | 税務事務所 (zeimu-jimusho), 税務者 (zeimusha), 税務庁 (zeimucho) | All three wrong variants observed. 署 is read しょ (sho), not しゃ (sha) or ちょ (cho). |
| 国税庁 (kokuzeichō, National Tax Agency) | 国税局 (kokuzeikyoku) is OK for regional bureaus | — |
| 国会 (kokkai, Diet/parliament) | 議会 (gikai) is for assemblies/councils, not the national Diet | — |
| 法務省 (Hōmu-shō, Ministry of Justice) | 法廷 (hōtei) = courtroom — different concept | — |
| 経済産業省 (Keizaisangyō-shō, METI) | 産業省 alone is wrong | — |

If you spot a wrong-ministry pattern in vocab or body, FIX it via newWords_fixes (for vocab) or body find-and-replace (for body). These are factual errors, not style.

If you spot one of these wrong words in the body where context makes the alternative clearer, FIX IT and add to fixes_made. These are body-level fixes — find-and-replace in body_romaji.

When you flag a kanji reading error, use newWords_fixes to update ALL THREE fields (word_kanji, word_kana, word_romaji_macron) consistently.

🛑 **CONSERVATISM**: Many kanji have multiple valid readings. Only flag if you're confident the chosen reading is WRONG for the given context — not just unusual. When in doubt, leave it.

**Also check for MALFORMED COMPOUND NOUNS — character order matters!**

Claude occasionally writes kanji compounds with the components in the WRONG order. These produce non-words that look plausible. The reading (furigana) will be just as wrong as the kanji, so wanakana check won't catch them. Verify each [NEW] word's kanji is a STANDARD ORDER compound:

| Wrong (reversed) | Right (standard) | Meaning |
|---|---|---|
| 150年周 (150-nenshū) | 150周年 (150-shūnen) | 150th anniversary |
| 額総価時 / 総額価時 | 時価総額 (jika sōgaku) | market capitalization |
| 公開株式 | 株式公開 (kabushiki kōkai) | initial public offering / IPO |
| 圧電高 | 高電圧 (kō-den'atsu) | high voltage |
| 設実 | 実設 / 施設 (shisetsu) | facility |
| 業作 | 作業 (sagyō) | work / operation |

If you find a body or vocab word with reversed compound order, fix it. Apply the fix to:
1. The vocab entry (word_kanji, word_kana, word_romaji_macron)
2. ALL occurrences in title/summary/body via find-and-replace

Pattern to scan for: any kanji compound that doesn't appear in standard Japanese — even if the individual kanji are common, their COMBINATION may be wrong. When in doubt, check if you've ever seen the exact compound before in Japanese text. If not, it's likely malformed.

### 15. AI NAMING — HEPBURN ROMAJI

人工知能 (AI) is **\`jinkō-chinō\`** in proper Hepburn — long ō on BOTH syllables. Fix any of these to \`jinkō-chinō\`:
- \`jinkō-chīno\` (long i on wrong syllable)
- \`jinkou-chinou\` (no macrons)
- \`jinkō-chino\` (missing second macron)

### 16. SUBJECT CLARITY (split dangling subjects)

Japanese \`~te\` chains share the topic subject. If subjects change mid-sentence, split into two clear sentences.

❌ "Kono kaisha wa Fureiburugu ni atte, jū-oku yūro wo tōshi suru yotei desu."
   (Implies the same company is in Freiburg AND investing.)
✅ "Prior Labs wa Fureiburugu ni arimasu. SAP wa jū-oku yūro wo tōshi suru yotei desu."

If you see a wa-topic followed by a te-chain that crosses to a different actor's verb, SPLIT into two sentences with explicit subjects.

### 18. BACKGROUND VOCABULARY LEVEL CHECK (especially important for N4/N5 users)

For low-level users (N4 or N5), the BACKGROUND vocabulary (everything not marked [NEW] or [REVIEW]) must be STRICTLY easier than the target level.

For an **N4 user**: background must be N5 only. The following N3 words COMMONLY leak into N4 articles as unmarked background — they MUST be replaced or promoted to [NEW]:

| N3 word (leaks as background) | Simpler N5 replacement | When to keep as [NEW] |
|---|---|---|
| 政府 (seifu, government) | 国 (kuni, country) | If specifically about government action |
| 建物 (tatemono, building) | 家 (ie, house) or ビル (biru) | If specifically about a building |
| 人口 (jinkō, population) | 人の数 (hito no kazu) | If demographics is the topic |
| 政策 (seisaku, policy) | ルール (rūru, rule) | If policy is the topic |
| 環境 (kankyō, environment) | 自然 (shizen) or まわり (mawari) | If environment IS the topic |
| 開発 (kaihatsu, development) | 作る (tsukuru) | If tech development is topic |
| 暖房 (danbō, heating) | ヒーター (hītā) | If heating IS the topic |
| 対策 (taisaku, countermeasure) | 方法 (hōhō, method, N4) | If the article is about a policy response |
| 技術 (gijutsu, technology) | leave as [NEW] | Almost always a teaching opportunity |

If you find 4+ unmarked N3 background words in an N4 article, fix the worst offenders by:
1. Replacing with the simpler N5 equivalent (if the meaning fits), OR
2. Promoting to [NEW] if the concept genuinely needs that word

For an **N5 user**: this is even stricter — all background should be the most basic N5. Same logic applies for N4 words leaking in.

For N3, N2, N1 users: this check is less critical (the level gap to "one tier below" gets smaller).

### 17. CORPORATE VERB / TONE CHOICES (only within JLPT budget)

Prefer business-appropriate verbs IF they stay within the user's level (will be given in the user prompt). Common upgrades that fit N3 and below:

| Less natural | More natural | Note |
|---|---|---|
| omotte imasu (思う, personal feeling) | kangaete imasu (考える, logical position) | both N4–N5, free upgrade |
| dekita (was made — childish for companies) | sōgyō shita (創業した, was founded) | sōgyō is N3, use as [NEW] |
| chiisai kaisha | sutātoappu (loanword) | loanword always allowed |
| kigyō yō (for companies) | kigyō-muke (企業向け) | same complexity |

🛑 **DO NOT introduce N2+ vocabulary into the article — that violates the user's level scaffolding.** Specifically NEVER substitute:
- ❌ ōte (大手) — N2
- ❌ setsuritsu (設立) — N2
- ❌ shinkō (新興) — N2

If the natural news word would be N2+, leave the simpler N4/N5 version OR pick another N3 alternative. **Background vocabulary must stay ≤ the user's target level.**

═══════════════════════════════════════════════════════════════════════
## 📚 WORKED EXAMPLES — study these patterns before reviewing

These are real bad→good corrections from prior articles. Each shows the BAD article excerpt, the GOOD correction, and WHY. Match the pattern when you see something similar.

### Example 1 — Wrong loanword for cloud computing
BAD:  "Kono chippu wa kumo to setsuzoku shinai de AI wo ugokasu."
GOOD: "Kono chippu wa kuraudo to setsuzoku shinai de AI wo ugokasu."
WHY:  "kumo" (雲) means clouds in the sky. For cloud computing, Japanese uses the loanword "kuraudo" (クラウド). Tech context = loanword wins.

### Example 2 — M&A consonant shift + currency
BAD:  "SAP wa Prior Labs no kaishū wo happyō shimashita. Ichi-gyaku yūro wo tsukau yotei desu."
GOOD: "SAP wa Prior Labs no baishū wo happyō shimashita. Jū-oku yūro wo tsukau yotei desu."
WHY:  (1) "kaishū" (回収) = recall/collection. For M&A/acquisition, the right word is "baishū" (買収). The source headline says "acquires" — must be baishū. (2) "ichi-gyaku" is NOT a word. €1 billion = "jū-oku yūro" (10×100M).

### Example 3 — Sentiment-ruining word in POSITIVE news (NARROW SCOPE)
BAD:  "Kono torihiki wa Doitsu no startup no seikō no mondai to natte imasu. Ōkii jiken desu."
GOOD: "Kono torihiki wa Doitsu no startup no seikō-rei to natte imasu. Ōkina dekigoto desu."
WHY:  (1) "seikō no mondai" = "a problem for success" — opposite of intended meaning. Use "seikō-rei" (success example) or "seikō no moderu" (model of success). (2) "jiken" (事件) implies crime/scandal. For a corporate acquisition (positive news), use "dekigoto" (出来事, event).

🛑 **GUARDRAIL — when NOT to apply this rule**:
If the article is GENUINELY about a problem (GDPR violations, privacy concerns, accidents, scandals, climate damage, etc.), then "mondai ga arimasu" (there are problems) is **CORRECT** Japanese — leave it alone!

| Article topic | "mondai" usage | Action |
|---|---|---|
| Acquisition / launch / breakthrough (positive news) | "seikō no mondai" (problem for success) | FIX → seikō-rei / seikō no moderu |
| AI privacy / GDPR concerns / data leaks | "puraibashī no mondai" (privacy issues) | LEAVE — these ARE problems |
| Earthquake / accident / scandal | "ōkii jiken/mondai" | LEAVE if context is genuinely negative |
| New product positive announcement | "ōkii jiken" (big incident) | FIX → ōkina dekigoto (big event) |

DO NOT change "mondai" → "kaigi" or "kenen" unless the article context is genuinely positive. The rule is about MISMATCHED sentiment, not about avoiding the word "mondai" everywhere.

If you're unsure, LEAVE THE ORIGINAL. mondai is a perfectly common word in news Japanese.

### Example 4 — Counter + AI verb
BAD:  "Niju-ko no koe no komando ga aru. AI wa dēta wo benkyō shimasu."
GOOD: "Nijū-shurui no koe no komando ga aru. AI wa dēta wo gakushū shimasu."
WHY:  (1) Software commands are KINDS, counted with "-shurui" (種類), not "-ko" (個, physical items). (2) AI doesn't "benkyō" (study at school — human verb). It does "gakushū suru" (機械学習 = machine learning).

### Example 5 — Subject clarity + corporate verb
BAD:  "Kono kaisha wa Fureiburugu ni atte, jū-oku yūro wo tōshi suru yotei desu. SAP wa yoi torihiki da to omotte imasu."
GOOD: "Prior Labs wa Fureiburugu ni arimasu. SAP wa jū-oku yūro wo tōshi suru yotei desu. SAP wa yoi torihiki da to kangaete imasu."
WHY:  (1) The te-form chain "atte" implies the SAME subject (Prior Labs) is also investing — but SAP is the investor. Split into two clear sentences. (2) "omotte imasu" (思う) is personal feeling. For a corporate stance use "kangaete imasu" (考える, logical position).

### Example 6 — Internal consistency
BAD:  "SAP wa Prior Labs wo baishū shimashita. Kono akuishishon wa ōkii dekigoto desu."
GOOD: "SAP wa Prior Labs wo baishū shimashita. Kono baishū wa ōkii dekigoto desu."
WHY:  Article already used "baishū" (standard Japanese for M&A). Don't switch to the awkward English "akuishishon" (アクイジション) later — Japanese news doesn't use it. Pick one term per concept; standard JP wins.

### Anti-Example 7 — When NOT to "fix" something (respect JLPT scaffolding)
BAD-LOOKING:   "Doitsu no ōkii sofutowea kaisha SAP wa..."
RESIST URGE TO CHANGE TO: "Doitsu no ōte sofutowea kaisha SAP wa..."
WHY KEEP ORIGINAL: "ōte" (大手, major company) is N2 vocabulary. The article is for an N3 user — background must stay at N4/N5. "ōkii" (N5) is the correct choice for this level. Same logic for "shinkō" (N2), "setsuritsu" (N2): NEVER introduce N2 vocab as "improvements". 🛑 Respect the scaffolding.

### Anti-Example 8 — Clean article, leave it alone
INPUT:  "SAP wa Doitsu no AI kigyō Prior Labs wo baishū shimashita. Jū-oku yūro wo yonnen de tōshi suru yotei desu."
ACTION: No fixes needed. Return article unchanged with fixes_made: [].
WHY:   Every word is correct, level-appropriate, factually accurate per source. Don't invent corrections just because you're called.

### Example 9 — Subject-aware verb choice for AI / robots / machines

**KEY RULE**: the verb depends on the SUBJECT. Check whether the subject is HUMAN or MACHINE before applying a fix.

#### 9a. Robot/machine + "hataraku" (human work verb)
BAD:  "Robotto wa 8 jikan ijō hataraite imashita."
GOOD: "Robotto wa 8 jikan ijō kinō shite imashita."
WHY:  Robots don't "hataraku" (働く, human labor). Use "kinō suru" (機能する, function) or "sagyō suru" (作業する, perform operations).

#### 9b. AI + "benkyō suru" or "kunren" (human learning verbs)
BAD:  "AI wa zeimu-dēta wo benkyō suru." / "AI no kunren ni dēta wo tsukau."
GOOD: "AI wa zeimu-dēta wo gakushū suru." / "AI no gakushū ni dēta wo tsukau."
WHY:  Machine learning is "gakushū" (学習, 機械学習). Human-only verbs to REPLACE in AI context:
  - "benkyō suru" (勉強, study at school) → "gakushū suru" (学習)
  - "kunren suru" / "kunren" (訓練, train a person) → "gakushū suru" / "gakushū"
  - "oshieru" (教える, teach) → "gakushū saseru" (let learn) or "kunren saseru" (train, but only as causative)
NOTE: when the same article has MULTIPLE instances of these wrong verbs, fix ALL of them — not just the first one.

#### 9c. ⚠️ DON'T OVER-CORRECT — humans use benkyō/kunren correctly
BAD-LOOKING:   "Doitsu no seifu wa data no anzen ni tsuite motto gakushū suru hitsuyō ga aru."
SHOULD BE:    "Doitsu no seifu wa data no anzen ni tsuite motto benkyō suru hitsuyō ga aru." (humans studying)
OR:           "Doitsu no seifu wa data no anzen ni tsuite motto kentō suru hitsuyō ga aru." (consider/examine)
WHY:  The German government (humans) studying data safety = "benkyō" or "kentō" (検討, to examine carefully). "gakushū" here would mean Germany itself is a machine learning model — nonsensical. Always check the subject of the verb before substituting.

### Example 10 — "dekita" for a company being founded
BAD:  "Humanoid wa 2024 nen ni dekita atarashii kaisha desu."
GOOD: "Humanoid wa 2024 nen ni sōgyō shita atarashii kaisha desu."
WHY:  "dekita" (出来た, "was made") is childish for company founding in news Japanese. Use "sōgyō shita" (創業した, was founded) for businesses. (Don't use "setsuritsu sareta" 設立 — that's N2, violates N3 scaffolding.)

═══════════════════════════════════════════════════════════════════════
## 🔁 SELF-CHECK BEFORE RETURNING

After drafting your fixes, scan the article ONE MORE TIME against this checklist. If you find something you missed, add it.

For EACH non-grammatical word in the article body, verify:

1. **Is the subject HUMAN or MACHINE?** Then verify the right verb (Example 9):
   - Subject = robot/AI/machine + "hataraku" → "kinō suru" / "sagyō suru"
   - Subject = AI/model + "benkyō" OR "kunren" → "gakushū suru" (fix ALL instances, not just first)
   - Subject = HUMAN/GOVERNMENT/PERSON + "gakushū" → revert to "benkyō" or "kentō" (gakushū applies to machines only)
2. **Is the topic a company/startup being founded?** If so, "dekita" → "sōgyō shita" (Example 10).
3. **Is the subject corporate and stating a position?** If so, "omotte imasu" → "kangaete imasu".
4. **Any [NEW] vocab word that looks like a non-word?** (e.g., "kurumagatari", "kono kae") — flag and propose a real-Japanese alternative.
5. **Are any kanji compound readings semantically off?** (e.g., "shinkyōdo" 深刻度 = "severity" being used to mean "advanced") — if the meaning_en doesn't match the kanji, flag it.
6. **Does any sentence have an illogical subject?** (e.g., "this success thinks..." — abstract noun as the subject of a thinking verb) — reword to passive or attribute to a person.
7. **Does the article use both standard Japanese + an awkward English katakana for the same concept?** (e.g., baishū + akuishishon) — normalize to one.
8. **For each [NEW] vocab entry**: does word_kana match a valid reading of word_kanji? E.g., 運送 should be うんそう (unsō), not ゆんそう. 30,000 should be 三万 (san-man), not 三十千. If wrong, flag via newWords_fixes (cat. 14). Be conservative — only flag obvious mismatches.
9. **Malformed compound order**: scan body AND vocab for kanji compounds with components in the WRONG order. E.g. 150年周 should be 150周年; 公開株式 should be 株式公開; 額総価時 should be 時価総額. Reversed compounds are non-words even though the individual kanji are common. Fix everywhere if found.
10. **Grammar ceiling**: scan for grammar structures ABOVE the user's level (given in the task section below) and downgrade them. Common drifters to replace: ~において/~における→~で; ~によって/~により→~で; ~に対して→~に; ~をめぐって→~について; ~つつある→~ている; ~ものの→~が; ~ざるを得ない→~なければならない; ~ゆえに→だから; ~にとって (romaji "ni totte", N3 — found in 8 past articles)→~には or rephrase ("hito ni totte ii basho" → "hito ni wa ii basho"). If the article reads more formally than the user's level could follow, simplify the grammar.
11. **Entity repetition**: if "kaisha" (or another generic noun) is repeated for an entity that HAS a proper name, replace repeats with the actual name (Amazon, Zoox, SAP, etc.) after the first mention. Improves flow and clarity.

These checks cost you nothing and catch real errors. Run them BEFORE returning your JSON.

═══════════════════════════════════════════════════════════════════════
## Keep the English translation in sync
The learner reads translation_en next to the article. If you remove, add, split, merge or change the meaning of ANY sentence, return translation_en updated to match the corrected body sentence for sentence (same paragraphs). Never leave a sentence in translation_en that is no longer in the body (#211: three removed sentences stayed in the English). Pure spelling/spacing fixes don't need a translation change — then return translation_en unchanged.

═══════════════════════════════════════════════════════════════════════
## What NOT to change
- Article length (keep within ±10% words)
- [NEW] and [REVIEW] markers — preserve EXACT positions
- Vocabulary word_kana / word_kanji fields — those came from a strong source
- Topic, storyline, structure
- Anything you're not sure about — leave it alone (re-read the anti-invention guardrails above)

═══════════════════════════════════════════════════════════════════════
## Output format
Respond with ONLY valid JSON (no markdown fences, no commentary):

{
  "title_romaji": "corrected title (or unchanged)",
  "summary_romaji": "corrected summary (or unchanged)",
  "body_romaji": "corrected body, markers preserved",
  "translation_en": "English translation matching the corrected body (unchanged if no sentence changed)",
  "newWords_fixes": [
    {"index": 0, "field": "word_romaji_macron", "from": "kaishū", "to": "baishū"}
  ],
  "fixes_made": [
    "Replaced kaishū (recall) with baishū (acquisition) — source headline is M&A",
    "Fixed €1 billion: was 'ichi-gyaku', now 'jū-oku yūro' (10×100M = 1B)"
  ]
}

If nothing needs fixing, return article unchanged with fixes_made: [].
If you make ANY fix, the fixes_made array MUST explain what and why.
newWords_fixes is for vocab-entry romaji corrections (index = 0-based in newWords array).`;
}

async function runQualityReviewer(article, newsData, config) {
  const writingSystem = article._writing_system || config.writing_system || 'romaji';
  console.log('[Reviewer] Running Japanese quality reviewer pass...');

  // Build the source-news context. Pass numbers and quotes PROMINENTLY since
  // those are the most common factual-drift hotspots.
  const sourceContext = (newsData.articles || [])
    .map(a => {
      const facts = (a.keyFacts || []).map(f => `  - ${f}`).join('\n') || '  (none)';
      const nums  = (a.numbers || []).map(n => `  - ${n}`).join('\n') || '  (none)';
      const quotes = (a.quotes || []).map(q => `  - "${q}"`).join('\n') || '  (none)';
      return `Source: ${a.source}
URL: ${a.url || '(n/a)'}
Headline: ${a.headline}

Key facts (verify article matches these):
${facts}

Numbers (CRITICAL — every numeric claim in the article must match one of these):
${nums}

Quotes:
${quotes}`;
    })
    .join('\n\n---\n\n') || `(no source available — topic: ${newsData.topic})`;

  const newWordsForReview = (article.newWords || [])
    .map((w, i) => `[${i}] word_romaji_macron="${w.word_romaji_macron}" word_kana="${w.word_kana || ''}" word_kanji="${w.word_kanji || ''}" meaning="${w.meaning_en}"`)
    .join('\n');

  const numberCheatSheet = buildNumberCheatSheet(newsData);

  const userPrompt = `## 🎯 USER LEVEL: ${config.proficiency_level}
This is the HARD ceiling for BOTH vocabulary and grammar. Nothing in the article — words or grammar structures — may exceed ${config.proficiency_level}. (Loanwords in katakana are level-exempt.)
${numberCheatSheet ? `\n${numberCheatSheet}\n🛑 If any money amount in the article does NOT match the correct form above, FIX it. A "$2.6 billion" valuation rendered as "450 doru" or "yonhyaku-gojū doru" is a critical factual error — replace with the exact form.\n` : ''}
## Source news (TRUTH — verify all article facts against this)
${sourceContext}

## Topic summary
${newsData.topic} (${newsData.region})

═══════════════════════════════════════════════════════════════════════
## Generated article to review

title_romaji:
${article.title_romaji}

summary_romaji:
${article.summary_romaji}

body_romaji:
${article.body_romaji}

translation_en:
${article.translation_en || '(none)'}

## Current vocabulary (newWords array)
${newWordsForReview || '(none)'}

═══════════════════════════════════════════════════════════════════════
## Your task
Review the article against your 17 error categories. Apply the ANTI-INVENTION GUARDRAILS — but rule #7: objective spelling errors MUST be fixed.

🛑 **Reminder**: respect the JLPT scaffolding. Don't introduce N2 vocabulary as a "fix" — see category 17. Background must stay ≤ user's level.

Specific checks for THIS article:
1. **Subject clarity** (category 15): any wa-topic followed by te-chain that crosses to a different subject's verb? Split into two sentences.
2. **AI naming**: any "jinkō-chīno" → "jinkō-chinō"? (Objective fix — chīno is not a word.)
3. **Macrons**: any common compound missing macrons? (seikou → seikō, koukou → kōkō, etc.)
4. **Currency** (cross-check source numbers): are all amounts using oku/man/jū-oku correctly?
5. **Sentiment**: is the article calling positive news a "mondai" (problem) or "jiken" (scandal)? Fix to "moderu/rei" or "dekigoto".
6. **Consistency**: does the article use both standard JP and awkward English katakana for the same concept (e.g. baishū + akuishishon)? Pick one and normalize.
7. **M&A vocab**: source mentions acquisition → must use "baishū", never "kaishū".
8. **AI verbs**: AI uses "gakushū suru" / "shori suru" — not "benkyō" or "kangaeru".
9. **News register**: "ijō" not "yori mo ōku" for numeric thresholds.
10. **Corporate verbs** (cat. 16, within JLPT budget): "kangaete imasu" over "omotte imasu" for corp stances; "sōgyō shita" over "dekita" for company founding (if sōgyō can be a [NEW] word); "kigyō-muke" over "kigyō yō".
11. **Tokenization**: passive te-forms joined (tsukawarete, not tsukaware te).
12. **Natural word combinations**: does every verb fit its object? A word-by-word translation can be grammatical but meaningless: "shokuji ya yasumu jikan wo tasukemasu" (helps meals and rest time, #211) → "shokuji wo yōi shimasu" / "yukkuri yasumeru yō ni tetsudaimasu". Fix only clear mismatches, with words at or below the user's level, and update translation_en if the meaning changes.

Return the corrected article. If nothing needs fixing, return it unchanged with fixes_made: [].`;

  try {
    const result = await callClaudeJSON(
      buildReviewerSystemPrompt(writingSystem),
      userPrompt,
      { max_tokens: 6144, temperature: 0 }
    );

    // Only apply each field if reviewer returned non-empty — never blank a
    // field on parse failure.
    if (result.title_romaji)   article.title_romaji   = result.title_romaji;
    if (result.summary_romaji) article.summary_romaji = result.summary_romaji;
    const bodyBefore = article.body_romaji || '';
    const translationBefore = article.translation_en || '';
    if (result.body_romaji)    article.body_romaji    = result.body_romaji;
    if (result.translation_en) article.translation_en = result.translation_en;

    if (Array.isArray(result.newWords_fixes) && article.newWords) {
      for (const fix of result.newWords_fixes) {
        const target = article.newWords[fix.index];
        if (target && fix.field && fix.to) {
          target[fix.field] = fix.to;
        }
      }
    }

    const fixesMade = Array.isArray(result.fixes_made) ? result.fixes_made : [];
    if (fixesMade.length > 0) {
      console.log(`[Reviewer] Made ${fixesMade.length} fix(es):`);
      fixesMade.forEach(f => console.log(`  • ${f}`));
    } else {
      console.log('[Reviewer] No fixes needed — article passed quality review.');
    }

    // Safety net: sentences were added/removed but the translation came back
    // unchanged → translate the corrected body again (2026-11-11; 29 of 128
    // articles had a stale translation before this).
    if (translationBefore && article.translation_en === translationBefore
        && sentenceCount(article.body_romaji) !== sentenceCount(bodyBefore)) {
      const fresh = await translateBody(article.body_romaji);
      if (fresh) {
        article.translation_en = fresh;
        fixesMade.push('Re-translated: sentences changed but the translation was not updated');
      }
    }

    return { article, fixesMade };
  } catch (err) {
    console.error('[Reviewer] Pass failed — keeping article as-is:', err.message);
    return { article, fixesMade: [] };
  }
}

function sentenceCount(text) {
  return String(text || '').split(/[.!?。！？]+/).filter(s => s.trim()).length;
}

/**
 * English translation of a romaji article body, sentence for sentence.
 * Used when the reviewer changed sentences without updating translation_en,
 * and to repair stored articles whose translation no longer matches.
 */
async function translateBody(bodyRomaji) {
  const body = String(bodyRomaji || '').replace(/\[(NEW|REVIEW)\]\s*/g, '').trim();
  if (!body) return null;
  try {
    const text = await callClaude(
      `You translate a short Japanese news article, written in Hepburn romaji, into plain English for a learner.
Translate sentence for sentence: same order, one English sentence per Japanese sentence, same paragraph breaks. Add nothing that is not in the Japanese and leave nothing out. Keep names as they are spelled in English (Karuizawa, Prince Hotels).
Respond with ONLY the translation.`,
      body,
      { effort: 'low' }
    );
    return text.trim() || null;
  } catch (err) {
    console.error('[Reviewer] Re-translation failed — keeping old translation:', err.message);
    return null;
  }
}

module.exports = {
  runQualityReviewer,
  translateBody,
  _internals: { sentenceCount },
};
