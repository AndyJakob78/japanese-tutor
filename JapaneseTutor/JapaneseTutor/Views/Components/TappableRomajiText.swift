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
        // Prefix match for conjugated forms
        for (key, vocab) in lookup {
            if lower.hasPrefix(key) && lower.count <= key.count + 4 { return vocab }
            if key.hasPrefix(lower) && key.count <= lower.count + 4 { return vocab }
            let keyNoMacron = stripMacrons(key)
            if noMacron.hasPrefix(keyNoMacron) && noMacron.count <= keyNoMacron.count + 4 { return vocab }
            if keyNoMacron.hasPrefix(noMacron) && keyNoMacron.count <= noMacron.count + 4 { return vocab }
        }
    }

    if writingSystem == "kana" {
        // Prefix match for kana conjugated forms
        for (key, vocab) in lookup {
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
/// - Tap any underlined vocabulary word to see inline translation right below that paragraph
/// - [NEW] and [REVIEW] markers stripped from display
/// - Supports romaji, kana, and kanji writing systems
struct TappableRomajiText: View {
    let text: String
    let vocabulary: [VocabularyWord]
    let writingSystem: String
    let fontSize: CGFloat
    let onWordTap: (VocabularyWord) -> Void

    init(text: String, vocabulary: [VocabularyWord], writingSystem: String = "romaji", fontSize: CGFloat = 17, onWordTap: @escaping (VocabularyWord) -> Void) {
        self.text = text
        self.vocabulary = vocabulary
        self.writingSystem = writingSystem
        self.fontSize = fontSize
        self.onWordTap = onWordTap
    }

    @State private var tappedWord: VocabularyWord?
    @State private var tappedParagraphIndex: Int = -1

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
                            if tappedWord?.id == word.id {
                                tappedWord = nil
                                tappedParagraphIndex = -1
                            } else {
                                tappedWord = word
                                tappedParagraphIndex = idx
                            }
                        }
                    }
                )

                // Tooltip appears right below the paragraph where the word was tapped
                if tappedParagraphIndex == idx, let word = tappedWord {
                    wordTooltip(word)
                }
            }
        }
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
            if let pos = word.partOfSpeech {
                Text(pos)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button {
                onWordTap(word)
            } label: {
                Image(systemName: "info.circle")
                    .font(.body)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.systemGray6))
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

    @State private var textHeight: CGFloat = 20

    var body: some View {
        SelectableTextView(
            paragraph: paragraph,
            vocabulary: vocabulary,
            writingSystem: writingSystem,
            fontSize: fontSize,
            calculatedHeight: $textHeight,
            onVocabTap: onVocabTap
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

    func makeCoordinator() -> Coordinator {
        Coordinator(onVocabTap: onVocabTap)
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

        for word in words {
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

            // Highlight if marked [NEW] and not a common particle/word
            let shouldHighlight = nextIsNew && !isCommonWord(cleaned, writingSystem: writingSystem)

            // Flexible vocabulary lookup for tap-to-translate
            let vocabMatch = findVocabMatch(cleaned, in: vocabLookup, writingSystem: writingSystem)

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
            }

            result.append(NSAttributedString(string: remaining, attributes: attrs))
            nextIsNew = false
        }

        return result
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, UITextViewDelegate {
        var onVocabTap: (VocabularyWord) -> Void
        var vocabulary: [VocabularyWord] = []

        init(onVocabTap: @escaping (VocabularyWord) -> Void) {
            self.onVocabTap = onVocabTap
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
            return true
        }
    }
}
