import Foundation
import SwiftUI

/// The language the user is learning. Japanese is the original app;
/// German and English are served from their own data on the server.
enum LearningLanguage: String, CaseIterable, Identifiable {
    case japanese = "ja"
    case german = "de"
    case english = "en"

    static let storageKey = "learningLanguage"
    var id: String { rawValue }

    static var current: LearningLanguage {
        LearningLanguage(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "ja") ?? .japanese
    }

    /// Name shown in the picker (each in the language of its learners).
    var pickerName: String {
        switch self {
        case .japanese: return "Japanese"
        case .german:   return "ドイツ語"
        case .english:  return "英語"
        }
    }

    /// Japanese name, used on the German / English screens.
    var nameJa: String {
        switch self {
        case .japanese: return "日本語"
        case .german:   return "ドイツ語"
        case .english:  return "英語"
        }
    }

    static let levels = ["A1-A2", "B1", "B2"]
    static func levelNameJa(_ level: String) -> String {
        switch level {
        case "A1-A2": return "入門 (A1–A2)"
        case "B1":    return "中級 (B1)"
        case "B2":    return "中上級 (B2)"
        default:      return level
        }
    }

    /// The level is kept per language on the device and sent with each request.
    var levelKey: String { "level_\(rawValue)" }
}

struct LangArticle: Codable, Identifiable {
    let id: Int
    let language: String?
    let level: String?
    let title: String
    let summary: String?
    let body: String?
    let translation: String?
    let vocabulary: [LangWord]?
    let grammarNote: LangGrammarNote?
    let quiz: [LangQuizQuestion]?
    let reviewVocabulary: [LangWord]?
    let sources: [LangSource]?
    let wordCount: Int?
    let newWordCount: Int?
    let createdAt: String?
    let readAt: String?
    let quizCompletedAt: String?
    let quizScore: Double?

    enum CodingKeys: String, CodingKey {
        case id, language, level, title, summary, body, translation, vocabulary, quiz, sources
        case grammarNote = "grammar_note"
        case reviewVocabulary = "review_vocabulary"
        case wordCount = "word_count"
        case newWordCount = "new_word_count"
        case createdAt = "created_at"
        case readAt = "read_at"
        case quizCompletedAt = "quiz_completed_at"
        case quizScore = "quiz_score"
    }

    /// "11月21日"
    var dateJa: String {
        guard let createdAt else { return "" }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: createdAt) else { return "" }
        let out = DateFormatter()
        out.locale = Locale(identifier: "ja_JP")
        out.dateFormat = "M月d日"
        return out.string(from: date)
    }
}

struct LangWord: Codable, Identifiable {
    let word: String
    let base: String
    let pos: String?
    let meaning: String
    let example: String?
    let exampleTranslation: String?
    // only in the word list
    let wordId: String?
    let timesSeen: Int?
    let lastSeenAt: String?
    var status: String?
    let article: String?      // der / die / das
    let headword: String?     // the word without article and plural
    let timesTested: Int?
    let streakCorrect: Int?

    var id: String { wordId ?? base }

    enum CodingKeys: String, CodingKey {
        case word, base, pos, meaning, example, status, article, headword
        case wordId = "id"
        case exampleTranslation = "example_translation"
        case timesSeen = "times_seen"
        case lastSeenAt = "last_seen_at"
        case timesTested = "times_tested"
        case streakCorrect = "streak_correct"
    }

    static func statusJa(_ status: String?) -> String {
        switch status {
        case "learning": return "学習中"
        case "known": return "覚えた"
        case "mastered": return "完璧"
        default: return "新しい"
        }
    }

    var posJa: String {
        switch (pos ?? "").lowercased() {
        case "noun": return "名詞"
        case "verb": return "動詞"
        case "adjective": return "形容詞"
        case "adverb": return "副詞"
        case "phrase": return "表現"
        default: return pos ?? ""
        }
    }
}

struct LangGrammarNote: Codable {
    let point: String
    let explanation: String
    let sentence: String?
}

struct LangQuizQuestion: Codable {
    let type: String?
    let instruction: String
    let question: String
    let options: [String]
    let answerIndex: Int
    let explanation: String

    enum CodingKeys: String, CodingKey {
        case type, instruction, question, options, explanation
        case answerIndex = "answer_index"
    }
}

struct LangSource: Codable {
    let title: String?
    let source: String?
    let url: String?
}

struct LangLookup: Codable, Identifiable {
    let word: String
    let base: String
    let pos: String
    let meaning: String
    let note: String?
    let example: String?
    let exampleTranslation: String?
    var vocabularyId: String?

    var id: String { base }

    enum CodingKeys: String, CodingKey {
        case word, base, pos, meaning, note, example
        case exampleTranslation = "example_translation"
        case vocabularyId = "vocabulary_id"
    }
}

struct LangAddWordRequest: Encodable {
    let word: String
    let base: String
    let pos: String
    let meaning: String
    let example: String?
    let exampleTranslation: String?
    let articleId: Int?

    enum CodingKeys: String, CodingKey {
        case word, base, pos, meaning, example
        case exampleTranslation = "example_translation"
        case articleId = "article_id"
    }
}

struct LangReviewResponse: Codable {
    let words: [LangWord]
}

struct LangTestResponse: Codable {
    let statusChanged: Bool
}

struct LangSentenceRequest: Encodable {
    struct Target: Encodable { let word: String; let meaning: String }
    let words: [Target]
    let sentence: String
    let context: String?
    let focus: String?
    let firstTry: Bool
    let level: String

    enum CodingKeys: String, CodingKey {
        case words, sentence, context, focus, level
        case firstTry = "first_try"
    }
}

struct LangSentenceCheck: Codable {
    struct Fix: Codable, Identifiable {
        let wrote: String
        let correct: String
        let why: String
        var id: String { wrote + correct }
    }
    struct WordUse: Codable {
        let word: String
        let usedCorrectly: Bool
        enum CodingKeys: String, CodingKey { case word; case usedCorrectly = "used_correctly" }
    }
    let verdict: String
    let corrected: String
    let translation: String
    let fixes: [Fix]
    let words: [WordUse]
    let tip: String
}

struct LangMistakesResponse: Codable {
    struct Example: Codable { let wrote: String; let correct: String; let why: String }
    struct WeakSpot: Codable, Identifiable {
        let typeLabel: String
        let pattern: String
        let count: Int
        let example: Example
        var id: String { typeLabel + pattern }
        enum CodingKeys: String, CodingKey { case pattern, count, example; case typeLabel = "type_label" }
    }
    struct Mistake: Codable, Identifiable {
        let createdAt: String
        let wrote: String
        let correct: String
        let why: String
        let sentence: String
        let corrected: String
        var id: String { createdAt + wrote + correct }
        enum CodingKeys: String, CodingKey { case wrote, correct, why, sentence, corrected; case createdAt = "created_at" }
    }
    let weakSpots: [WeakSpot]
    let mistakes: [Mistake]
    let count: Int
    enum CodingKeys: String, CodingKey { case mistakes, count; case weakSpots = "weak_spots" }
}

struct LangStats: Codable {
    struct Vocabulary: Codable {
        struct ByStatus: Codable {
            let new: Int
            let learning: Int
            let known: Int
            let mastered: Int
        }
        let total: Int
        let byStatus: ByStatus
        let dueForReview: Int
    }
    struct Articles: Codable { let total: Int; let read: Int; let quizzed: Int }
    struct Quiz: Codable { let averageScore: Int? }
    let vocabulary: Vocabulary
    let articles: Articles
    let quiz: Quiz
    let streak: Int
}

struct LangArticleListResponse: Codable {
    let articles: [LangArticle]
}

struct LangVocabularyResponse: Codable {
    let vocabulary: [LangWord]
    let total: Int?
    let counts: [String: Int]?
}

struct LangQuizResult: Codable {
    let correct: Int
    let total: Int
    let score: Int
}

struct LangDeleteResponse: Codable {
    let deleted: Bool
}

/// The language picker, used in the Japanese settings and the German / English settings.
struct LearningLanguagePicker: View {
    let title: String
    @AppStorage(LearningLanguage.storageKey) private var learningLanguage = LearningLanguage.japanese.rawValue

    var body: some View {
        Picker(title, selection: $learningLanguage) {
            ForEach(LearningLanguage.allCases) { language in
                Text(title == "Learning language" ? language.pickerName : language.nameJa).tag(language.rawValue)
            }
        }
    }
}
