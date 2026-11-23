import Foundation

/// GET /api/progress — everything the progress screen shows.
/// The rules behind these numbers are described in PROGRESS_SCREEN.md (server/services/progress.js).
struct LearningProgress: Codable {
    struct Level: Codable { let known: Int; let total: Int; let percent: Int }

    /// Time to the next level. `available` is false while there is too little data.
    struct Estimate: Codable {
        let available: Bool
        let done: Bool?
        let value: Int?
        let unit: String?       // days | weeks | months | over
        let date: String?       // "2027-06-14"
        let needDays: Int?
        let needWords: Int?
        enum CodingKeys: String, CodingKey { case available, done, value, unit, date; case needDays = "need_days"; case needWords = "need_words" }
    }

    /// The same estimate at another pace: "daily" review, or one "more" article a day.
    struct Scenario: Codable, Identifiable {
        let key: String
        let value: Int?
        let unit: String
        let date: String?
        var id: String { key }
    }

    struct Reason: Codable {
        let daysCloser: Int?
        let streak: Int?
        let goal: Bool?
        enum CodingKeys: String, CodingKey { case streak, goal; case daysCloser = "days_closer" }
    }

    /// The one thing to do next. kind: welcome_back | review | read | quiz | practise | type | goal | new_article
    struct NextAction: Codable {
        let kind: String
        let count: Int?
        let minutes: Int?
        let articleId: Int?
        let pattern: String?
        let goal: String?
        let reason: Reason
        enum CodingKeys: String, CodingKey { case kind, count, minutes, pattern, goal, reason; case articleId = "article_id" }
    }

    struct WeakSpot: Codable {
        struct Example: Codable { let wrote: String; let correct: String; let why: String }
        let pattern: String
        let typeLabel: String?
        let count: Int
        let example: Example?
        let articleId: Int?
        enum CodingKeys: String, CodingKey { case pattern, count, example; case typeLabel = "type_label"; case articleId = "article_id" }
    }

    struct Streak: Codable {
        struct Day: Codable, Identifiable { let date: String; let done: Bool; let today: Bool; var id: String { date } }
        struct NextBadge: Codable { let days: Int; let toGo: Int; enum CodingKeys: String, CodingKey { case days; case toGo = "to_go" } }
        let current: Int
        let best: Int
        let activeToday: Bool
        let week: [Day]
        let nextBadge: NextBadge?
        enum CodingKeys: String, CodingKey { case current, best, week; case activeToday = "active_today"; case nextBadge = "next_badge" }
    }

    struct WeekGain: Codable { let days: Int }
    struct Goal: Codable, Identifiable { let key: String; let done: Int; let target: Int; var id: String { key } }
    struct Badge: Codable, Identifiable {
        let key: String
        let group: String       // level | streak | typed | articles
        let value: FlexibleValue
        let earnedAt: String?
        var id: String { key }
        enum CodingKeys: String, CodingKey { case key, group, value; case earnedAt = "earned_at" }
    }
    struct Totals: Codable {
        let words: Int; let due: Int
        let typedRight: Int?; let articlesRead: Int?
        enum CodingKeys: String, CodingKey { case words, due; case typedRight = "typed_right"; case articlesRead = "articles_read" }
    }

    let level: String
    let nextLevel: String?
    let progress: Level
    let pacePerWeek: Double
    let estimate: Estimate
    let scenarios: [Scenario]
    let nextAction: NextAction
    let weakSpot: WeakSpot?
    let streak: Streak
    let weekGain: WeekGain?
    let goals: [Goal]
    let badges: [Badge]
    let totals: Totals

    enum CodingKeys: String, CodingKey {
        case level, progress, estimate, scenarios, streak, goals, badges, totals
        case nextLevel = "next_level"
        case pacePerWeek = "pace_per_week"
        case nextAction = "next_action"
        case weakSpot = "weak_spot"
        case weekGain = "week_gain"
    }
}

/// A badge's value is a number (7 days, 100 words) or a level name ("N5").
struct FlexibleValue: Codable {
    let text: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) { text = String(n) } else { text = (try? c.decode(String.self)) ?? "" }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(text) }
}
