import Foundation
import SwiftUI

/// The language the user is learning. All three use the SAME screens.
/// Japanese is taught in English; German and English are taught in Japanese
/// (those learners are Japanese speakers), so every text on screen goes
/// through `L(english, japanese)`.
enum LearningLanguage: String, CaseIterable, Identifiable {
    case japanese = "ja"
    case german = "de"
    case english = "en"

    static let storageKey = "learningLanguage"
    var id: String { rawValue }

    static var current: LearningLanguage {
        LearningLanguage(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "ja") ?? .japanese
    }

    var isJapanese: Bool { self == .japanese }

    /// The course a brand-new install starts in (1.7). A phone set to Japanese belongs to a
    /// Japanese speaker, who comes for English (or German), so it starts in the English
    /// course; every other phone starts in the Japanese course. Runs only before the first
    /// setup is finished and only when no course was stored yet, so existing users and
    /// anyone who already switched in Settings keep their course.
    static func chooseForNewInstall(preferred: [String] = Locale.preferredLanguages, defaults: UserDefaults = .standard) {
        guard !defaults.bool(forKey: "hasCompletedOnboarding"), defaults.string(forKey: storageKey) == nil else { return }
        defaults.set(course(forPhoneLanguages: preferred).rawValue, forKey: storageKey)
    }

    /// "ja-JP" first → English course; anything else → Japanese course.
    static func course(forPhoneLanguages preferred: [String]) -> LearningLanguage {
        (preferred.first ?? "").lowercased().hasPrefix("ja") ? .english : .japanese
    }

    /// Name shown in the picker (each in the language of its learners).
    var pickerName: String {
        switch self {
        case .japanese: return "Japanese"
        case .german:   return "ドイツ語"
        case .english:  return "英語"
        }
    }

    /// Name of the language being learned, in the language of the interface.
    var targetName: String { pickerName }

    /// Levels of this course: JLPT for Japanese, the European scale for German / English.
    var levels: [String] {
        isJapanese ? ["N5", "N4", "N3", "N2", "N1"] : ["A1-A2", "B1", "B2"]
    }

    var defaultLevel: String { isJapanese ? "N5" : "A1-A2" }
}

/// English for the Japanese course, Japanese for the German / English courses.
func L(_ english: String, _ japanese: String) -> String {
    LearningLanguage.current == .japanese ? english : japanese
}

/// Names of fixed values (status, part of speech, topics, ...) in the interface language.
enum Labels {
    static func status(_ status: String) -> String {
        switch status {
        case "new": return L("New", "新しい")
        case "learning": return L("Learning", "学習中")
        case "known": return L("Known", "覚えた")
        case "mastered": return L("Mastered", "完璧")
        case "All": return L("All", "すべて")
        default: return status.capitalized
        }
    }

    static func partOfSpeech(_ pos: String) -> String {
        guard !LearningLanguage.current.isJapanese else { return pos }
        switch pos.lowercased() {
        case "noun": return "名詞"
        case "verb": return "動詞"
        case "adjective": return "形容詞"
        case "adverb": return "副詞"
        case "phrase": return "表現"
        case "name": return "名前"
        default: return pos
        }
    }

    static func quizType(_ type: String) -> String {
        guard !LearningLanguage.current.isJapanese else { return type.capitalized }
        switch type.lowercased() {
        case "comprehension": return "内容"
        case "vocabulary": return "単語"
        case "grammar": return "文法"
        default: return type
        }
    }

    private static let topics: [String: String] = [
        "politics": "政治", "technology": "テクノロジー", "finance": "金融", "sport": "スポーツ", "sports": "スポーツ",
        "science": "科学", "culture": "文化", "environment": "環境", "health": "健康", "startups": "スタートアップ",
        "society and daily life": "社会・くらし", "nature and environment": "自然・環境", "travel": "旅行",
        "food": "食べ物", "business": "ビジネス", "music": "音楽", "art": "アート",
        "local news": "地元のニュース", "family": "家族・子ども", "holidays": "祭り・行事",
        "weather": "天気", "beauty": "美容",
    ]

    private static let regions: [String: String] = [
        "japan": "日本", "germany": "ドイツ", "austria": "オーストリア", "switzerland": "スイス",
        "united states": "アメリカ", "usa": "アメリカ", "us": "アメリカ", "united kingdom": "イギリス", "uk": "イギリス",
        "france": "フランス", "south korea": "韓国", "china": "中国", "brazil": "ブラジル", "india": "インド",
        "australia": "オーストラリア", "canada": "カナダ", "ireland": "アイルランド", "europe": "ヨーロッパ",
    ]

    /// Topics and regions are stored as the learner typed them (or as the English key
    /// of a chip); known keys get a Japanese name on the German / English screens.
    /// "cooking and home recipes" → "Cooking and home recipes"
    private static func firstUpper(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    static func topic(_ key: String) -> String {
        LearningLanguage.current.isJapanese ? key.capitalized : (topics[key.lowercased()] ?? firstUpper(key))
    }

    static func region(_ key: String) -> String {
        LearningLanguage.current.isJapanese ? key.capitalized : (regions[key.lowercased()] ?? key.capitalized)
    }
}

/// What the learner types in a review, taken from the dictionary form:
///   "die Regierung, -en" → article "die", headword "Regierung"
///   "rise (rose, risen)" → headword "rise"
enum WordAnswer {
    static func parts(_ base: String) -> (article: String?, headword: String) {
        var main = base
        if let paren = main.range(of: "(") { main = String(main[..<paren.lowerBound]) }
        main = (main.split(separator: ",").first.map(String.init) ?? main).trimmingCharacters(in: .whitespaces)
        if let match = main.firstMatch(of: /^(der|die|das)(?:\/(?:der|die|das))?\s+(.+)$/.ignoresCase()) {
            return (String(match.1).lowercased(), String(match.2))
        }
        return (nil, main)
    }

    /// Lowercase; umlauts may be typed as ae / oe / ue / ss.
    static func normalize(_ text: String) -> String {
        text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "ä", with: "ae").replacingOccurrences(of: "ö", with: "oe")
            .replacingOccurrences(of: "ü", with: "ue").replacingOccurrences(of: "ß", with: "ss")
            .replacingOccurrences(of: "’", with: "'")
            .split(separator: " ").joined(separator: " ")
    }
}

/// The language picker in the settings.
struct LearningLanguagePicker: View {
    let title: String
    @AppStorage(LearningLanguage.storageKey) private var learningLanguage = LearningLanguage.japanese.rawValue

    var body: some View {
        Picker(title, selection: $learningLanguage) {
            ForEach(LearningLanguage.allCases) { language in
                Text(language.pickerName).tag(language.rawValue)
            }
        }
    }
}
