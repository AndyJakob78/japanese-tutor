import Foundation

struct VocabularyWord: Codable, Identifiable {
    let id: Int
    let wordRomaji: String
    let wordRomajiMacron: String
    let wordKanji: String?
    let wordKana: String?
    let meaningEn: String
    let partOfSpeech: String?
    let jlptLevel: String?
    let category: String?
    let status: String
    let timesSeen: Int?
    let timesUsedCorrectly: Int?
    let timesTested: Int?
    let timesTestedCorrect: Int?
    let streakCorrect: Int?
    let firstSeenAt: String?
    let lastSeenAt: String?
    let lastTestedAt: String?
    let nextReviewAt: String?
    let firstSeenInArticleId: Int?

    // From article_vocabulary join — SQLite returns 0/1 not true/false
    let isNew: IntBool?
    let isReview: IntBool?
    let contextSentence: String?

    enum CodingKeys: String, CodingKey {
        case id
        case wordRomaji = "word_romaji"
        case wordRomajiMacron = "word_romaji_macron"
        case wordKanji = "word_kanji"
        case wordKana = "word_kana"
        case meaningEn = "meaning_en"
        case partOfSpeech = "part_of_speech"
        case jlptLevel = "jlpt_level"
        case category
        case status
        case timesSeen = "times_seen"
        case timesUsedCorrectly = "times_used_correctly"
        case timesTested = "times_tested"
        case timesTestedCorrect = "times_tested_correct"
        case streakCorrect = "streak_correct"
        case firstSeenAt = "first_seen_at"
        case lastSeenAt = "last_seen_at"
        case lastTestedAt = "last_tested_at"
        case nextReviewAt = "next_review_at"
        case firstSeenInArticleId = "first_seen_in_article_id"
        case isNew = "is_new"
        case isReview = "is_review"
        case contextSentence = "context_sentence"
    }

    var statusColor: String {
        switch status {
        case "new": return "gray"
        case "learning": return "orange"
        case "known": return "blue"
        case "mastered": return "green"
        default: return "gray"
        }
    }
}

/// Decodes both Bool (true/false) and Int (0/1) from JSON.
/// SQLite returns integers for boolean columns.
struct IntBool: Codable {
    let value: Bool

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let boolVal = try? container.decode(Bool.self) {
            value = boolVal
        } else if let intVal = try? container.decode(Int.self) {
            value = intVal != 0
        } else {
            value = false
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

struct VocabularyListResponse: Codable {
    let vocabulary: [VocabularyWord]
    let total: Int
}

struct VocabularyDueResponse: Codable {
    let due: [VocabularyWord]
    let count: Int
}

struct TestResultResponse: Codable {
    let word: VocabularyWord
    let statusChanged: Bool
}
