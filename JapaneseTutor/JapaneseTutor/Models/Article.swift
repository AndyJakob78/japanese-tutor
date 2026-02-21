import Foundation

struct Article: Codable, Identifiable {
    let id: Int
    let titleRomaji: String
    let summaryRomaji: String?
    let bodyRomaji: String?
    let translationEn: String?
    let grammarPoints: [GrammarPoint]?
    let sources: [Source]?
    let topic: String?
    let region: String?
    let wordCount: Int?
    let newWordCount: Int?
    let reviewWordCount: Int?
    let difficultyScore: Double?
    let createdAt: String?
    let readAt: String?
    let quizCompletedAt: String?
    let quizScore: Double?
    let writingSystem: String?

    // Populated when fetching a single article
    let vocabulary: [VocabularyWord]?
    let quizQuestions: [QuizQuestion]?

    enum CodingKeys: String, CodingKey {
        case id
        case titleRomaji = "title_romaji"
        case summaryRomaji = "summary_romaji"
        case bodyRomaji = "body_romaji"
        case translationEn = "translation_en"
        case grammarPoints = "grammar_points"
        case sources
        case topic, region
        case wordCount = "word_count"
        case newWordCount = "new_word_count"
        case reviewWordCount = "review_word_count"
        case difficultyScore = "difficulty_score"
        case createdAt = "created_at"
        case readAt = "read_at"
        case quizCompletedAt = "quiz_completed_at"
        case quizScore = "quiz_score"
        case writingSystem = "writing_system"
        case vocabulary
        case quizQuestions = "quiz_questions"
    }
}

struct GrammarPoint: Codable {
    let pattern: String
    let level: String
    let explanation: String
    let examples: [String]?
}

struct Source: Codable {
    let name: String
    let url: String?
}

struct ArticleListResponse: Codable {
    let articles: [Article]
    let pagination: Pagination
}

struct Pagination: Codable {
    let page: Int
    let limit: Int
    let total: Int
    let pages: Int
}

struct DeleteResponse: Codable {
    let deleted: Bool
    let articleId: Int?
    let deletedVocabulary: Bool?
    let vocabularyDeletedCount: Int?

    enum CodingKeys: String, CodingKey {
        case deleted
        case articleId = "article_id"
        case deletedVocabulary = "deleted_vocabulary"
        case vocabularyDeletedCount = "vocabulary_deleted_count"
    }
}
