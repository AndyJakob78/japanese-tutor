import Foundation

/// When to ask for an App Store rating (1.7, agreed with the team):
///   - the learner read at least 2 articles,
///   - and was active on at least 2 different days (article read, quiz finished,
///     review word answered or sentence checked — the same things as the streak),
///   - right after a quiz with every answer correct,
///   - at most once per app version.
/// Never after the paywall, an error or a wrong answer (the quiz path guarantees this).
enum RatingRule {
    private static let daysKey = "ratingActiveDays"
    private static let articlesKey = "ratingArticlesRead"
    private static let askedKey = "ratingAskedVersion"

    private static var today: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    private static var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    static func recordActiveDay() {
        let d = UserDefaults.standard
        var days = Set(d.stringArray(forKey: daysKey) ?? [])
        guard !days.contains(today) else { return }
        days.insert(today)
        d.set(Array(days.sorted().suffix(30)), forKey: daysKey)
    }

    static func recordArticleRead(_ id: Int) {
        let d = UserDefaults.standard
        var ids = Set((d.array(forKey: articlesKey) as? [Int]) ?? [])
        ids.insert(id)
        d.set(Array(ids.sorted().suffix(30)), forKey: articlesKey)
        recordActiveDay()
    }

    /// True once per version, when the rule allows it. Marks it as asked.
    static func shouldAskAfterQuiz(correct: Int, total: Int) -> Bool {
        let d = UserDefaults.standard
        guard total > 0, correct == total,
              d.string(forKey: askedKey) != version,
              (d.stringArray(forKey: daysKey) ?? []).count >= 2,
              ((d.array(forKey: articlesKey) as? [Int]) ?? []).count >= 2 else { return false }
        d.set(version, forKey: askedKey)
        return true
    }
}
