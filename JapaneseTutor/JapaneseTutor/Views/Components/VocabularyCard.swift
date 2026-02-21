import SwiftUI

struct VocabularyCard: View {
    let word: VocabularyWord
    var writingSystem: String = "romaji"

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(primaryText)
                        .font(.subheadline.weight(.medium))

                    // Show secondary script info
                    if writingSystem == "romaji", let kanji = word.wordKanji {
                        Text(kanji)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Show romaji as subtitle for non-romaji modes
                if writingSystem != "romaji" {
                    Text(word.wordRomajiMacron)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Text(word.meaningEn)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                if let level = word.jlptLevel {
                    Text(level)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(levelColor(level).opacity(0.15))
                        .foregroundStyle(levelColor(level))
                        .clipShape(Capsule())
                }

                if let pos = word.partOfSpeech {
                    Text(pos)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 12)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    /// Primary display text based on writing system
    private var primaryText: String {
        switch writingSystem {
        case "kanji":
            if let kanji = word.wordKanji, let kana = word.wordKana {
                return "\(kanji)（\(kana)）"
            }
            return word.wordKana ?? word.wordRomajiMacron
        case "kana":
            return word.wordKana ?? word.wordRomajiMacron
        default:
            return word.wordRomajiMacron
        }
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "N5": return .green
        case "N4": return .blue
        case "N3": return .orange
        case "N2": return .red
        case "N1": return .purple
        default: return .gray
        }
    }
}
