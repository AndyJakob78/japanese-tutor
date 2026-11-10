# Kanji + Furigana Writing Standards

## System
Natural Japanese with kanji. Every kanji compound gets furigana in parentheses.

## Furigana Format
Use full-width parentheses immediately after each kanji word:
- 首相（しゅしょう）は 新（あたら）しい 経済（けいざい）政策（せいさく）を 発表（はっぴょう）しました。
- NOT: 首相は新しい経済政策を発表しました。 (missing furigana)
- NOT: 首相(しゅしょう) (wrong parentheses — use full-width （）)

## Word Spacing (this drives the romaji conversion downstream)

The text is converted to romaji by splitting on your spaces, so spaces must sit
exactly at word boundaries — no more, no fewer.

**A word is one unit with no spaces inside it:** kanji + its furigana + its
okurigana / conjugation ending. Write the okurigana directly after the closing
）, with no space:
- 大（おお）きい ・ 新（あたら）しい ・ 小（ちい）さい ・ 多（おお）く
- 使（つか）って ・ 減（へ）って ・ 建（た）てて ・ 来（き）ます ・ 思（おも）います
- 取（と）り扱（あつか）い ・ 引（ひ）き受（う）ける ・ 一（ひと）つ目（め）

**Put one space between words:** before and after each particle (は が を に へ で
と や か も の から まで より など だけ), before です/でした, before a separate
auxiliary such as います after a te-form, and before する/します after a noun.
- 首相（しゅしょう） は 新（あたら）しい 経済（けいざい） 政策（せいさく） を 発表（はっぴょう） しました。
- ロボット や 機械（きかい） を 使（つか）って います。
- 情報（じょうほう） を 送（おく）る と、 答（こた）えます。 (conditional と is its own word)

Wrong — space inside a word (becomes "ō kii", "tsuka tte", "e tte" in romaji):
大（おお） きい ・ 使（つか） って ・ 減（へ） って
Wrong — two words glued (becomes "robottoya", "okuruto"):
ロボットや ・ 送（おく）ると

## Kanji Level by JLPT
- **N5**: ~100 basic kanji (日、本、人、大、小、中、国、年、月、時 etc.)
- **N4**: ~300 kanji (新、古、高、安、近、遠、強、弱 etc.)
- **N3**: ~650 kanji (経済、政治、社会、技術、発表 etc.)
- **N2**: ~1000 kanji (more advanced compounds)
- Use kanji AT or BELOW the user's JLPT level
- For kanji above the user's level, write in hiragana instead

## Katakana
Use katakana for loanwords and foreign names (no furigana needed):
- ドイツ、アメリカ、コンピューター、テクノロジー

## [NEW] and [REVIEW] Markers
Place markers before the word:
- [NEW]首相（しゅしょう）は [REVIEW]経済（けいざい）の [NEW]政策（せいさく）を 発表（はっぴょう）しました。

## Rules for Furigana
- ALWAYS add furigana to every kanji, even common ones
- Single kanji verbs/adjectives: 新（あたら）しい、大（おお）きい、見（み）る
- Compound words: 経済（けいざい）、政治（せいじ）
- Names with kanji: 東京（とうきょう）、大阪（おおさか）
- Numbers: 一（いち）、二（に）、三（さん） — or use Arabic numerals (1、2、3)
