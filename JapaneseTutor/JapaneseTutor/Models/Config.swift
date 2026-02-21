import Foundation

struct AppConfig: Codable {
    var proficiencyLevel: String
    var maxSentenceLength: Int
    var newWordsPerArticle: Int
    var targetWordCount: Int
    var reuseRatio: Double
    var topics: [String]
    var regions: [String]
    var newsTimeframeHours: Int
    var enabledSources: [String]
    var excludedSources: [String]
    var includePodcasts: Bool
    var quizQuestionsCount: Int
    var writingSystem: String
    var autoGenerate: Bool
    var autoGenerateIntervalHours: Int

    enum CodingKeys: String, CodingKey {
        case proficiencyLevel = "proficiency_level"
        case maxSentenceLength = "max_sentence_length"
        case newWordsPerArticle = "new_words_per_article"
        case targetWordCount = "target_word_count"
        case reuseRatio = "reuse_ratio"
        case topics, regions
        case newsTimeframeHours = "news_timeframe_hours"
        case enabledSources = "enabled_sources"
        case excludedSources = "excluded_sources"
        case includePodcasts = "include_podcasts"
        case quizQuestionsCount = "quiz_questions_count"
        case writingSystem = "writing_system"
        case autoGenerate = "auto_generate"
        case autoGenerateIntervalHours = "auto_generate_interval_hours"
    }

    // Custom decoder to handle missing fields from Firestore
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        proficiencyLevel = (try? container.decode(String.self, forKey: .proficiencyLevel)) ?? "N3"
        maxSentenceLength = (try? container.decode(Int.self, forKey: .maxSentenceLength)) ?? 18
        newWordsPerArticle = (try? container.decode(Int.self, forKey: .newWordsPerArticle)) ?? 12
        targetWordCount = (try? container.decode(Int.self, forKey: .targetWordCount)) ?? 200
        reuseRatio = (try? container.decode(Double.self, forKey: .reuseRatio)) ?? 0.65
        topics = (try? container.decode([String].self, forKey: .topics)) ?? ["politics", "finance", "technology", "startups"]
        regions = (try? container.decode([String].self, forKey: .regions)) ?? ["germany", "japan", "us"]
        newsTimeframeHours = (try? container.decode(Int.self, forKey: .newsTimeframeHours)) ?? 48
        enabledSources = (try? container.decode([String].self, forKey: .enabledSources)) ?? []
        excludedSources = (try? container.decode([String].self, forKey: .excludedSources)) ?? []
        includePodcasts = (try? container.decode(Bool.self, forKey: .includePodcasts)) ?? true
        quizQuestionsCount = (try? container.decode(Int.self, forKey: .quizQuestionsCount)) ?? 7
        writingSystem = (try? container.decode(String.self, forKey: .writingSystem)) ?? "romaji"
        autoGenerate = (try? container.decode(Bool.self, forKey: .autoGenerate)) ?? false
        autoGenerateIntervalHours = (try? container.decode(Int.self, forKey: .autoGenerateIntervalHours)) ?? 24
    }

    init(proficiencyLevel: String, maxSentenceLength: Int, newWordsPerArticle: Int, targetWordCount: Int = 200,
         reuseRatio: Double, topics: [String], regions: [String], newsTimeframeHours: Int,
         enabledSources: [String], excludedSources: [String], includePodcasts: Bool,
         quizQuestionsCount: Int, writingSystem: String = "romaji", autoGenerate: Bool, autoGenerateIntervalHours: Int) {
        self.proficiencyLevel = proficiencyLevel
        self.maxSentenceLength = maxSentenceLength
        self.newWordsPerArticle = newWordsPerArticle
        self.targetWordCount = targetWordCount
        self.reuseRatio = reuseRatio
        self.topics = topics
        self.regions = regions
        self.newsTimeframeHours = newsTimeframeHours
        self.enabledSources = enabledSources
        self.excludedSources = excludedSources
        self.includePodcasts = includePodcasts
        self.quizQuestionsCount = quizQuestionsCount
        self.writingSystem = writingSystem
        self.autoGenerate = autoGenerate
        self.autoGenerateIntervalHours = autoGenerateIntervalHours
    }

    static let `default` = AppConfig(
        proficiencyLevel: "N3",
        maxSentenceLength: 18,
        newWordsPerArticle: 12,
        targetWordCount: 200,
        reuseRatio: 0.65,
        topics: ["politics", "finance", "technology", "startups"],
        regions: ["germany", "japan", "us"],
        newsTimeframeHours: 48,
        enabledSources: ["handelsblatt.com", "spiegel.de", "reuters.com"],
        excludedSources: [],
        includePodcasts: true,
        quizQuestionsCount: 7,
        autoGenerate: false,
        autoGenerateIntervalHours: 24
    )
}

struct StatsResponse: Codable {
    let vocabulary: VocabularyStats
    let articles: ArticleStats
    let quiz: QuizStats
    let streak: Int
}

struct VocabularyStats: Codable {
    let total: Int
    let byStatus: StatusCounts
    let byLevel: [LevelCount]
    let dueForReview: Int
}

struct StatusCounts: Codable {
    let new_: Int
    let learning: Int
    let known: Int
    let mastered: Int

    enum CodingKeys: String, CodingKey {
        case new_ = "new"
        case learning, known, mastered
    }
}

struct LevelCount: Codable {
    let jlptLevel: String
    let count: Int

    enum CodingKeys: String, CodingKey {
        case jlptLevel = "jlpt_level"
        case count
    }
}

struct ArticleStats: Codable {
    let total: Int
    let read: Int
    let quizzed: Int
}

struct QuizStats: Codable {
    let averageScore: Int?
}
