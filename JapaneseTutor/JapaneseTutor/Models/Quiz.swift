import Foundation

struct QuizQuestion: Codable, Identifiable {
    let id: Int
    let articleId: Int?
    let type: String
    let questionRomaji: String
    let questionEn: String?
    let correctAnswer: String
    let distractors: [String]
    let hint: String?
    let vocabularyId: Int?
    let answeredCorrectly: IntBool?
    let answeredAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case articleId = "article_id"
        case type
        case questionRomaji = "question_romaji"
        case questionEn = "question_en"
        case correctAnswer = "correct_answer"
        case distractors, hint
        case vocabularyId = "vocabulary_id"
        case answeredCorrectly = "answered_correctly"
        case answeredAt = "answered_at"
    }

    /// All answer options shuffled (correct + distractors)
    var allOptions: [String] {
        var options = distractors
        options.append(correctAnswer)
        return options.shuffled()
    }
}

struct QuizResponse: Codable {
    let articleId: Int
    let articleTitle: String
    let questions: [QuizQuestion]
    let total: Int
    let answered: Int
    let correct: Int

    enum CodingKeys: String, CodingKey {
        case articleId = "article_id"
        case articleTitle = "article_title"
        case questions, total, answered, correct
    }
}

struct QuizAnswer: Codable {
    let questionId: Int
    let answer: String

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case answer
    }
}

struct QuizSubmitRequest: Codable {
    let answers: [QuizAnswer]
}

struct QuizResult: Codable {
    let questionId: Int?
    let correct: Bool?
    let yourAnswer: String?
    let correctAnswer: String?
    let hint: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case correct
        case yourAnswer = "your_answer"
        case correctAnswer = "correct_answer"
        case hint, error
    }
}

struct QuizSubmitResponse: Codable {
    let results: [QuizResult]
    let score: QuizScore
}

struct QuizScore: Codable {
    let correct: Int
    let total: Int
    let percentage: Int
}
