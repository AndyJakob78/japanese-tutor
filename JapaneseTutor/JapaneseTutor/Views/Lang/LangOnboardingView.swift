import SwiftUI

/// Themes for German / English articles. Kept on the device per language and
/// sent with each "new article" request, one after the other.
enum LangTopics {
    static let all: [(key: String, ja: String)] = [
        ("science", "科学"), ("technology", "テクノロジー"), ("culture", "文化"), ("sport", "スポーツ"),
        ("society and daily life", "社会・くらし"), ("nature and environment", "自然・環境"), ("health", "健康"),
        ("travel", "旅行"), ("food", "食べ物"), ("business", "ビジネス"),
    ]
    static let defaults = ["science", "technology", "culture", "society and daily life", "nature and environment"]
    private static var key: String { "topics_\(LearningLanguage.current.rawValue)" }

    static var selected: [String] {
        get { UserDefaults.standard.stringArray(forKey: key) ?? defaults }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// The next theme in turn, so two articles in a row differ.
    static func next() -> String? {
        let list = selected
        guard !list.isEmpty else { return nil }
        let counterKey = "\(key)_counter"
        let n = UserDefaults.standard.integer(forKey: counterKey)
        UserDefaults.standard.set(n + 1, forKey: counterKey)
        return list[n % list.count]
    }
}

struct LangTopicChips: View {
    @State private var selected = Set(LangTopics.selected)

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(LangTopics.all, id: \.key) { topic in
                let on = selected.contains(topic.key)
                Button {
                    if on { if selected.count > 1 { selected.remove(topic.key) } } else { selected.insert(topic.key) }
                    LangTopics.selected = LangTopics.all.map(\.key).filter { selected.contains($0) }
                } label: {
                    Text(topic.ja)
                        .font(.footnote.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(on ? Color.accentColor : Color(.secondarySystemBackground), in: Capsule())
                        .foregroundStyle(on ? Color.white : Color.primary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }
}

/// First launch: what do you want to learn? Japanese continues with the
/// original (English) setup; German and English get a short Japanese setup.
struct LangOnboardingView: View {
    /// true = setup finished (German / English); false = continue with the Japanese setup
    var onDone: (_ finished: Bool) -> Void

    @AppStorage(LearningLanguage.storageKey) private var learningLanguage = LearningLanguage.japanese.rawValue
    @State private var picked: LearningLanguage?
    @State private var level = "A1-A2"

    var body: some View {
        NavigationStack {
            ScrollView {
                if let picked, picked != .japanese { setup(picked) } else { chooser }
            }
            .animation(.easeInOut(duration: 0.25), value: picked)
        }
    }

    private var chooser: some View {
        VStack(spacing: 14) {
            Image(systemName: "newspaper.fill").font(.system(size: 52)).foregroundStyle(Color.accentColor).padding(.top, 48)
            Text("What do you want to learn?").font(.title2.bold())
            Text("何を学びますか？").font(.title3).foregroundStyle(.secondary)
            option(.japanese, "Japanese", "For English speakers · news in romaji, kana or kanji", "🇯🇵")
            option(.english, "英語", "日本語で学ぶ · 今日のニュースをやさしい英語で", "🇺🇸")
            option(.german, "ドイツ語", "日本語で学ぶ · 今日のニュースをやさしいドイツ語で", "🇩🇪")
        }
        .padding()
    }

    private func option(_ language: LearningLanguage, _ title: String, _ subtitle: String, _ flag: String) -> some View {
        Button {
            learningLanguage = language.rawValue
            if language == .japanese { onDone(false) } else { picked = language }
        } label: {
            HStack(spacing: 14) {
                Text(flag).font(.system(size: 34))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline)
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }

    private func setup(_ language: LearningLanguage) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Button { picked = nil } label: { Label("戻る", systemImage: "chevron.left") }.padding(.top, 8)
            Text("\(language.nameJa)のレベルを選んでください").font(.title2.bold())
            ForEach(LearningLanguage.levels, id: \.self) { l in
                Button { level = l } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(LearningLanguage.levelNameJa(l)).font(.headline)
                            Text(l == "A1-A2" ? "短い文、基本の単語。はじめての方に。" : l == "B1" ? "日常の話題なら読める方に。" : "ニュースをほぼそのまま読みたい方に。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: level == l ? "checkmark.circle.fill" : "circle").foregroundStyle(level == l ? Color.accentColor : Color.secondary)
                    }
                    .padding(14)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
            Text("記事のテーマ").font(.headline).padding(.top, 6)
            LangTopicChips()
            Text("最初の3本の記事は無料です。レベルとテーマはあとで設定から変えられます。")
                .font(.footnote).foregroundStyle(.secondary)
            Button {
                UserDefaults.standard.set(level, forKey: language.levelKey)
                onDone(true)
            } label: {
                Text("はじめる").frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
