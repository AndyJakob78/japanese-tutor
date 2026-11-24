import SwiftUI
import UIKit

// MARK: - Common Word Filter

private let commonRomajiWords: Set<String> = {
    let words = [
        // Particles
        "wa", "ga", "wo", "no", "ni", "de", "to", "mo", "ka", "e", "ya",
        "kara", "made", "yo", "ne", "na", "he", "ba", "shi", "te",
        "nado", "dake", "shika", "bakari", "hodo", "kurai", "gurai",
        // Copulas / auxiliaries
        "da", "desu", "deshita", "datta", "nai", "masen",
        // Basic verbs
        "suru", "aru", "iru", "naru", "iku", "kuru", "miru", "iu", "omou",
        "shita", "shite", "sareta", "sareru", "dekiru", "natta", "natte",
        "ita", "imasu", "arimasu", "shimasu", "shimashita",
        "itta", "itte", "mita", "kita", "narimashita",
        "sa", "se", "su",
        // Pronouns / demonstratives
        "watashi", "boku", "kare", "kanojo", "karera",
        "kore", "sore", "are", "dore",
        "kono", "sono", "ano", "dono",
        "koko", "soko", "asoko", "doko",
        // Basic conjunctions / adverbs
        "soshite", "shikashi", "demo", "dakara", "sorede", "mata",
        "totemo", "sugoku", "motto", "mada", "yoku", "chotto",
        // Very basic nouns
        "koto", "mono", "toki", "hito", "naka", "ue", "mae", "ato",
        // Common sentence-enders
        "mashita", "masu", "tai", "rashii", "sou",
    ]
    return Set(words)
}()

// Common kana particles/words that should not be highlighted
private let commonKanaWords: Set<String> = {
    Set([
        "は", "が", "を", "の", "に", "で", "と", "も", "か", "へ", "や",
        "から", "まで", "よ", "ね", "な", "ば", "し", "て",
        "だ", "です", "でした", "だった", "ない", "ません",
        "する", "ある", "いる", "なる", "いく", "くる", "みる", "いう", "おもう",
        "した", "して", "された", "される", "できる",
        "わたし", "ぼく", "かれ", "かのじょ",
        "これ", "それ", "あれ", "この", "その", "あの",
        "ここ", "そこ", "あそこ", "どこ",
        "そして", "しかし", "でも", "だから", "そうです",
        "とても", "もっと", "まだ", "よく", "ちょっと",
        "こと", "もの", "とき", "ひと", "なか", "うえ", "まえ", "あと",
        "ました", "ます", "たい", "らしい", "そう",
    ])
}()

private func stripMacrons(_ text: String) -> String {
    text.replacingOccurrences(of: "ā", with: "a")
        .replacingOccurrences(of: "ī", with: "i")
        .replacingOccurrences(of: "ū", with: "u")
        .replacingOccurrences(of: "ē", with: "e")
        .replacingOccurrences(of: "ō", with: "o")
}

/// Strip furigana parentheses from kanji text: 経済（けいざい） → 経済
private func stripFurigana(_ text: String) -> String {
    // Remove full-width parenthesized readings: （...）
    text.replacingOccurrences(of: "（[^）]*）", with: "", options: .regularExpression)
}

/// Extract just the furigana reading from a kanji word: 経済（けいざい） → けいざい
private func extractFurigana(_ text: String) -> String? {
    guard let range = text.range(of: "（[^）]+）", options: .regularExpression) else { return nil }
    let match = String(text[range])
    return String(match.dropFirst().dropLast()) // Remove （ and ）
}

private func isCommonWord(_ word: String, writingSystem: String) -> Bool {
    // the lists below are Japanese particles; "to", "no", "so" are ordinary German / English words
    guard LearningLanguage.current.isJapanese else { return false }
    if writingSystem == "kana" || writingSystem == "kanji" {
        let stripped = stripFurigana(word)
        return commonKanaWords.contains(stripped)
    }
    return commonRomajiWords.contains(stripMacrons(word.lowercased()))
}

/// Flexible vocabulary lookup: tries exact match, then without macrons/furigana, then prefix match.
private func findVocabMatch(_ word: String, in lookup: [String: VocabularyWord], writingSystem: String) -> VocabularyWord? {
    let cleaned = word
    // 1. Exact match
    if let match = lookup[cleaned] { return match }

    if writingSystem == "kanji" {
        // Try without furigana: 経済（けいざい） → 経済
        let kanjiOnly = stripFurigana(cleaned)
        if let match = lookup[kanjiOnly] { return match }
        // Try the furigana reading
        if let reading = extractFurigana(cleaned), let match = lookup[reading] { return match }
    }

    if writingSystem == "romaji" {
        let lower = cleaned.lowercased()
        if let match = lookup[lower] { return match }
        let noMacron = stripMacrons(lower)
        if let match = lookup[noMacron] { return match }
        // Prefix match for conjugated forms. Short words (particles like
        // "ga", "no", "ni") only match exactly — otherwise "ga" linked to
        // "gamen" and every particle in the article was underlined.
        // German / English: endings are shorter ("rise" / "rises", "Regierung" / "Regierungen"),
        // and short words are everywhere ("ran" must not link to "range")
        let japanese = LearningLanguage.current.isJapanese
        let minLength = japanese ? 3 : 4
        let slack = japanese ? 4 : 3
        guard noMacron.count >= minLength else { return nil }
        for (key, vocab) in lookup where stripMacrons(key).count >= minLength {
            if lower.hasPrefix(key) && lower.count <= key.count + slack { return vocab }
            if key.hasPrefix(lower) && key.count <= lower.count + slack { return vocab }
            let keyNoMacron = stripMacrons(key)
            if noMacron.hasPrefix(keyNoMacron) && noMacron.count <= keyNoMacron.count + slack { return vocab }
            if keyNoMacron.hasPrefix(noMacron) && keyNoMacron.count <= noMacron.count + slack { return vocab }
        }
    }

    if writingSystem == "kana" {
        // Prefix match for kana conjugated forms (single-kana particles
        // like が・の only match exactly, same reason as romaji above)
        guard cleaned.count >= 2 else { return nil }
        for (key, vocab) in lookup where key.count >= 2 {
            if cleaned.hasPrefix(key) && cleaned.count <= key.count + 3 { return vocab }
            if key.hasPrefix(cleaned) && key.count <= cleaned.count + 3 { return vocab }
        }
    }

    return nil
}

// MARK: - SwiftUI View

/// Article text with:
/// - Native iOS text selection (drag to select, blue handles, Copy menu)
/// - Bold + colored new vocabulary words (filtered: no particles/common words)
/// - Tap any underlined vocabulary word to see its translation in a small card at the bottom
/// - Tap any other word to look it up (meaning in this sentence) and add it to your words
/// - [NEW] and [REVIEW] markers stripped from display
/// - Supports romaji, kana, and kanji writing systems
struct TappableRomajiText: View {
    let text: String
    let vocabulary: [VocabularyWord]
    let writingSystem: String
    let fontSize: CGFloat
    let articleId: Int?
    let onWordTap: (VocabularyWord) -> Void
    /// Called after a looked-up word was added, so the article can reload its vocabulary
    let onWordAdded: (() -> Void)?

    init(text: String, vocabulary: [VocabularyWord], writingSystem: String = "romaji", fontSize: CGFloat = 17, articleId: Int? = nil, onWordTap: @escaping (VocabularyWord) -> Void, onWordAdded: (() -> Void)? = nil) {
        self.text = text
        self.vocabulary = vocabulary
        self.writingSystem = writingSystem
        self.fontSize = fontSize
        self.articleId = articleId
        self.onWordTap = onWordTap
        self.onWordAdded = onWordAdded
    }

    @State private var tappedWord: VocabularyWord?
    @State private var tappedParagraphIndex: Int = -1
    /// Any other word that was tapped (looked up on the server)
    @State private var lookup: LookupState?

    struct LookupState: Equatable {
        let tapped: String
        let sentence: String
        var result: WordLookup?
        var failed = false
        var adding = false
        var added = false

        static func == (a: LookupState, b: LookupState) -> Bool {
            a.tapped == b.tapped && a.sentence == b.sentence && a.added == b.added && a.adding == b.adding
                && a.failed == b.failed && (a.result == nil) == (b.result == nil)
        }
    }

    /// Lookups already made this session ("sagatta|sentence" → result)
    private static var lookupCache: [String: WordLookup] = [:]

    var body: some View {
        let paragraphs = text.components(separatedBy: "\n\n").filter {
            !$0.trimmingCharacters(in: .whitespaces).isEmpty
        }

        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { idx, paragraph in
                // Paragraph text (native UITextView)
                ParagraphTextView(
                    paragraph: paragraph,
                    vocabulary: vocabulary,
                    writingSystem: writingSystem,
                    fontSize: fontSize,
                    onVocabTap: { word in
                        withAnimation(.easeInOut(duration: 0.2)) {
                            lookup = nil
                            if tappedWord?.id == word.id {
                                tappedWord = nil
                                tappedParagraphIndex = -1
                            } else {
                                tappedWord = word
                                tappedParagraphIndex = idx
                            }
                        }
                    },
                    onLookupTap: { word, sentence in
                        startLookup(word: word, sentence: sentence, paragraph: idx)
                    }
                )

            }
        }
        // The word card floats at the bottom of the screen. It used to sit below the
        // tapped paragraph, but articles are often one long paragraph, so the card
        // appeared under the whole article, off-screen. The article stays scrollable
        // and tappable while the card is open; tapping another word updates it.
        .sheet(isPresented: cardShown) {
            Group {
                if let word = tappedWord {
                    wordTooltip(word)
                } else if let lookup {
                    lookupTooltip(lookup)
                }
            }
            // The sheep sits on the card's top edge and looks down at the meaning
            .overlay(alignment: .topTrailing) {
                CornerSheep(pose: .lookDown, width: 52, flipped: true)
                    .offset(x: -18, y: -50)
            }
            .padding(.horizontal, 16)
            .padding(.top, 52)
            .padding(.bottom, 8)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cardHeight = $0 }
            .presentationDetents([.height(max(cardHeight, 90))])
            .presentationDragIndicator(.visible)
            .presentationBackgroundInteraction(.enabled)
            .presentationCornerRadius(22)
        }
        // Leaving the article (quiz, back) closes the word card; it used to stay open on top
        .onDisappear {
            tappedWord = nil
            lookup = nil
            tappedParagraphIndex = -1
        }
    }

    @State private var cardHeight: CGFloat = 110

    private var cardShown: Binding<Bool> {
        Binding(
            get: { tappedWord != nil || lookup != nil },
            set: { shown in
                if !shown {
                    tappedWord = nil
                    lookup = nil
                    tappedParagraphIndex = -1
                }
            }
        )
    }

    // MARK: Lookup of any word

    private func startLookup(word: String, sentence: String, paragraph: Int) {
        withAnimation(.easeInOut(duration: 0.2)) {
            tappedWord = nil
            if lookup?.tapped == word && tappedParagraphIndex == paragraph {
                lookup = nil
                tappedParagraphIndex = -1
                return
            }
            tappedParagraphIndex = paragraph
            lookup = LookupState(tapped: word, sentence: sentence, result: Self.lookupCache["\(word)|\(sentence)"])
        }
        guard lookup?.result == nil else { return }
        Task {
            let result = try? await APIClient.shared.lookupWord(word, sentence: sentence)
            guard lookup?.tapped == word else { return }   // another word was tapped meanwhile
            if let result { Self.lookupCache["\(word)|\(sentence)"] = result }
            withAnimation(.easeInOut(duration: 0.2)) {
                lookup?.result = result
                lookup?.failed = result == nil
            }
        }
    }

    private func addLookedUpWord() {
        guard let state = lookup, let result = state.result else { return }
        lookup?.adding = true
        Task {
            let saved = try? await APIClient.shared.addVocabulary(result, articleId: articleId, contextSentence: state.sentence)
            guard lookup?.tapped == state.tapped else { return }
            lookup?.adding = false
            if saved != nil {
                lookup?.added = true
                onWordAdded?()
            } else {
                lookup?.failed = true
            }
        }
    }

    @ViewBuilder
    private func lookupTooltip(_ state: LookupState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let r = state.result {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(r.wordRomajiMacron)
                        .font(.callout.weight(.semibold))
                    if writingSystem != "romaji" || r.wordKanji != nil {
                        Text(writingSystem == "kana" ? (r.wordKana ?? "") : (r.wordKanji ?? r.wordKana ?? ""))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let level = r.jlptLevel {
                        Text(level)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(r.meaningEn)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if !r.note.isEmpty {
                    Text(r.note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // Names and particles aren't vocabulary to learn
                // German / English: the example sentence that comes with the lookup
                if let example = r.example, !example.isEmpty {
                    Text(example)
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !["name", "particle"].contains(r.partOfSpeech ?? "") {
                    if r.vocabularyId != nil || state.added {
                        Label(state.added ? L("Added to your words", "単語帳に追加しました") : L("Already in your words", "単語帳に入っています"), systemImage: "checkmark.circle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.green)
                    } else {
                        Button {
                            addLookedUpWord()
                        } label: {
                            HStack(spacing: 4) {
                                if state.adding { ProgressView().controlSize(.small) }
                                Label(L("Add to my words", "単語帳に追加"), systemImage: "plus.circle.fill")
                            }
                            .font(.caption.weight(.semibold))
                        }
                        .disabled(state.adding)
                    }
                }
            } else if state.failed {
                Text(L("Couldn't look up \"\(state.tapped)\". Tap it again to retry.", "「\(state.tapped)」を調べられませんでした。もう一度タップしてください。"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(L("Looking up \(state.tapped)…", "「\(state.tapped)」を調べています…"))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    @ViewBuilder
    private func wordTooltip(_ word: VocabularyWord) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                // Show word in the most useful form based on writing system
                if writingSystem == "kanji", let kanji = word.wordKanji, let kana = word.wordKana {
                    Text("\(kanji)（\(kana)）")
                        .font(.callout.weight(.semibold))
                } else if writingSystem == "kana", let kana = word.wordKana {
                    Text(kana)
                        .font(.callout.weight(.semibold))
                } else {
                    Text(word.wordRomajiMacron)
                        .font(.callout.weight(.semibold))
                }
                // Always show romaji as reference
                if writingSystem != "romaji" {
                    Text(word.wordRomajiMacron)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Text(word.meaningEn)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let pos = word.partOfSpeech, !pos.isEmpty {
                Text(Labels.partOfSpeech(pos))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button {
                tappedWord = nil
                tappedParagraphIndex = -1
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onWordTap(word) }
            } label: {
                Image(systemName: "info.circle")
                    .font(.body)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

// MARK: - Per-Paragraph UITextView

/// A single paragraph rendered as a UITextView with native selection and vocab tap links.
private struct ParagraphTextView: View {
    let paragraph: String
    let vocabulary: [VocabularyWord]
    let writingSystem: String
    let fontSize: CGFloat
    let onVocabTap: (VocabularyWord) -> Void
    let onLookupTap: (String, String) -> Void

    @State private var textHeight: CGFloat = 20

    var body: some View {
        SelectableTextView(
            paragraph: paragraph,
            vocabulary: vocabulary,
            writingSystem: writingSystem,
            fontSize: fontSize,
            calculatedHeight: $textHeight,
            onVocabTap: onVocabTap,
            onLookupTap: onLookupTap
        )
        .frame(height: textHeight)
    }
}

// MARK: - UIKit UITextView Wrapper

private struct SelectableTextView: UIViewRepresentable {
    let paragraph: String
    let vocabulary: [VocabularyWord]
    let writingSystem: String
    let fontSize: CGFloat
    @Binding var calculatedHeight: CGFloat
    let onVocabTap: (VocabularyWord) -> Void
    let onLookupTap: (String, String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onVocabTap: onVocabTap, onLookupTap: onLookupTap)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isScrollEnabled = false
        textView.backgroundColor = .clear
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.linkTextAttributes = [:] // We style links ourselves
        textView.dataDetectorTypes = []
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.onVocabTap = onVocabTap
        context.coordinator.onLookupTap = onLookupTap
        context.coordinator.vocabulary = vocabulary

        let attrString = buildNSAttributedString()
        textView.attributedText = attrString

        // Calculate required height
        let maxWidth = textView.superview?.bounds.width ?? UIScreen.main.bounds.width - 32
        let size = attrString.boundingRect(
            with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        )
        let newHeight = ceil(size.height) + 8
        DispatchQueue.main.async {
            if abs(self.calculatedHeight - newHeight) > 1 {
                self.calculatedHeight = newHeight
            }
        }
    }

    private func buildNSAttributedString() -> NSAttributedString {
        let result = NSMutableAttributedString()
        let baseFont = UIFont.systemFont(ofSize: fontSize)
        let boldFont = UIFont.boldSystemFont(ofSize: fontSize)
        let accentColor = UIColor.tintColor
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 5

        let baseAttrs: [NSAttributedString.Key: Any] = [
            .font: baseFont,
            .foregroundColor: UIColor.label,
            .paragraphStyle: paragraphStyle,
        ]

        // Build vocabulary lookup with keys for all writing systems
        var vocabLookup: [String: VocabularyWord] = [:]
        for word in vocabulary {
            if !LearningLanguage.current.isJapanese {
                // German / English: the word as written in the text and its headword.
                // Not the dictionary form — "das Ei" would make every "das" a link.
                vocabLookup[word.wordRomaji.lowercased()] = word
                let head = WordAnswer.parts(word.wordRomajiMacron).headword.lowercased()
                if vocabLookup[head] == nil { vocabLookup[head] = word }
                continue
            }
            // Romaji keys
            vocabLookup[word.wordRomajiMacron.lowercased()] = word
            vocabLookup[word.wordRomaji.lowercased()] = word
            let noMacron = stripMacrons(word.wordRomajiMacron.lowercased())
            if vocabLookup[noMacron] == nil {
                vocabLookup[noMacron] = word
            }
            // Kana key
            if let kana = word.wordKana, !kana.isEmpty {
                vocabLookup[kana] = word
            }
            // Kanji key
            if let kanji = word.wordKanji, !kanji.isEmpty {
                vocabLookup[kanji] = word
            }
        }

        let trimmed = paragraph.trimmingCharacters(in: .whitespaces)
        let words = trimmed.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        var nextIsNew = false
        var first = true

        // A new word can be an expression of several words ("ma ni au"). The whole expression is
        // one link in one style — before, only its first word was coloured and nothing was tappable.
        func plain(_ token: String) -> String {
            let t = token.replacingOccurrences(of: "[NEW]", with: "").replacingOccurrences(of: "[REVIEW]", with: "")
                .trimmingCharacters(in: .punctuationCharacters)
            return (writingSystem == "kanji" ? stripFurigana(t) : t).lowercased()
        }
        func phraseMatch(at index: Int) -> (word: VocabularyWord, length: Int)? {
            guard writingSystem != "kanji", writingSystem != "kana" else { return nil }   // those scripts have no spaces inside a word
            for length in stride(from: 4, through: 2, by: -1) where index + length <= words.count {
                let joined = words[index..<(index + length)].map(plain).joined(separator: " ")
                if let m = vocabLookup[joined] ?? vocabLookup[stripMacrons(joined)] { return (m, length) }
            }
            return nil
        }
        var phrase: (word: VocabularyWord, left: Int)?

        for (index, word) in words.enumerated() {
            var remaining = word

            // Strip leading markers
            while remaining.hasPrefix("[NEW]") || remaining.hasPrefix("[REVIEW]") {
                if remaining.hasPrefix("[NEW]") {
                    nextIsNew = true
                    remaining = String(remaining.dropFirst(5))
                } else if remaining.hasPrefix("[REVIEW]") {
                    remaining = String(remaining.dropFirst(8))
                }
            }

            if remaining.isEmpty { continue }

            remaining = remaining.replacingOccurrences(of: "[NEW]", with: "")
            remaining = remaining.replacingOccurrences(of: "[REVIEW]", with: "")
            if remaining.isEmpty { continue }

            if !first {
                result.append(NSAttributedString(string: " ", attributes: baseAttrs))
            }
            first = false

            // Clean word for matching (strip punctuation, furigana for kanji mode)
            let cleaned: String
            if writingSystem == "kanji" {
                cleaned = stripFurigana(remaining.trimmingCharacters(in: .punctuationCharacters))
            } else {
                cleaned = remaining.trimmingCharacters(in: .punctuationCharacters)
            }

            // Flexible vocabulary lookup for tap-to-translate; an expression takes all its words
            if phrase == nil, let found = phraseMatch(at: index) { phrase = (found.word, found.length) }
            let inPhrase = phrase != nil
            let vocabMatch = phrase?.word ?? findVocabMatch(cleaned, in: vocabLookup, writingSystem: writingSystem)
            if let p = phrase { phrase = p.left > 1 ? (p.word, p.left - 1) : nil }

            // Two styles only: a NEW word of this article is coloured at every occurrence (not just
            // where the marker stands); a known word is underlined. Common particles stay plain.
            let isNewWord = vocabMatch?.isNew?.value == true
            let shouldHighlight = inPhrase ? (isNewWord || nextIsNew)
                : ((nextIsNew || isNewWord) && !isCommonWord(cleaned, writingSystem: writingSystem))

            var attrs = baseAttrs
            if shouldHighlight {
                attrs[.font] = boldFont
                attrs[.foregroundColor] = accentColor
            }

            // Make vocabulary words tappable via link
            if let match = vocabMatch {
                let linkURL = URL(string: "vocab://\(match.id)")!
                attrs[.link] = linkURL
                if shouldHighlight {
                    attrs[.foregroundColor] = accentColor
                } else {
                    attrs[.foregroundColor] = UIColor.label
                }
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
                attrs[.underlineColor] = UIColor.systemGray3
            } else if cleaned.rangeOfCharacter(from: .letters) != nil,
                      var link = URLComponents(string: "lookup://word") {
                // Any other word: tappable for a lookup, but it looks like plain text
                link.queryItems = [URLQueryItem(name: "w", value: cleaned)]
                if let url = link.url {
                    attrs[.link] = url
                    if !shouldHighlight { attrs[.foregroundColor] = UIColor.label }
                }
            }

            // The full stop, comma or closing quote after a word is not part of the word:
            // it stays plain ("pitcher." was coloured and underlined including the dot).
            let closers = CharacterSet(charactersIn: ".,!?;:'\"’”。、！？")
            var core = remaining
            var tail = ""
            while let last = core.unicodeScalars.last, closers.contains(last), core.count > 1 {
                tail = String(core.removeLast()) + tail
            }
            result.append(NSAttributedString(string: core, attributes: attrs))
            if !tail.isEmpty { result.append(NSAttributedString(string: tail, attributes: baseAttrs)) }
            nextIsNew = false
        }

        return result
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, UITextViewDelegate {
        var onVocabTap: (VocabularyWord) -> Void
        var onLookupTap: (String, String) -> Void
        var vocabulary: [VocabularyWord] = []

        init(onVocabTap: @escaping (VocabularyWord) -> Void, onLookupTap: @escaping (String, String) -> Void) {
            self.onVocabTap = onVocabTap
            self.onLookupTap = onLookupTap
        }

        /// The sentence around the tapped range — context for the lookup ("sagatta" in a stock sentence)
        private func sentence(in text: String, around range: NSRange) -> String {
            let ns = text as NSString
            let enders = CharacterSet(charactersIn: ".!?。！？")
            var start = range.location
            while start > 0, let scalar = UnicodeScalar(ns.character(at: start - 1)), !enders.contains(scalar) { start -= 1 }
            var end = range.location + range.length
            while end < ns.length, let scalar = UnicodeScalar(ns.character(at: end)), !enders.contains(scalar) { end += 1 }
            if end < ns.length { end += 1 }
            return ns.substring(with: NSRange(location: start, length: end - start)).trimmingCharacters(in: .whitespaces)
        }

        func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
            if URL.scheme == "vocab" {
                if let idString = URL.host, let id = Int(idString) {
                    if let word = vocabulary.first(where: { $0.id == id }) {
                        onVocabTap(word)
                    }
                }
                return false
            }
            if URL.scheme == "lookup" {
                let word = URLComponents(url: URL, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "w" })?.value ?? ""
                if !word.isEmpty {
                    onLookupTap(word, sentence(in: textView.text ?? "", around: characterRange))
                }
                return false
            }
            return true
        }
    }
}
