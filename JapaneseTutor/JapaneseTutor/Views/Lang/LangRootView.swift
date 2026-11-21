import SwiftUI

/// Tabs for German / English. The interface is Japanese: these learners are Japanese speakers.
struct LangRootView: View {
    var body: some View {
        TabView {
            NavigationStack { LangFeedView() }
                .tabItem { Label("記事", systemImage: "doc.text") }
            NavigationStack { LangWordsView() }
                .tabItem { Label("単語", systemImage: "character.book.closed") }
            NavigationStack { LangStatsView() }
                .tabItem { Label("統計", systemImage: "chart.bar") }
            NavigationStack { LangSettingsView() }
                .tabItem { Label("設定", systemImage: "gear") }
        }
    }
}

// MARK: - Settings

struct LangSettingsView: View {
    @State private var level: String = UserDefaults.standard.string(forKey: LearningLanguage.current.levelKey) ?? "A1-A2"

    var body: some View {
        Form {
            Section {
                LearningLanguagePicker(title: "学習する言語")
            } footer: {
                Text("言語ごとに記事と単語は別々に保存されます。")
            }
            Section("レベル") {
                Picker("レベル", selection: $level) {
                    ForEach(LearningLanguage.levels, id: \.self) { Text(LearningLanguage.levelNameJa($0)).tag($0) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section {
                LangTopicChips()
            } header: {
                Text("記事のテーマ")
            } footer: {
                Text("選んだテーマから順番にニュースを探します。")
            }
        }
        .navigationTitle("設定")
        .onChange(of: level) { _, new in
            UserDefaults.standard.set(new, forKey: LearningLanguage.current.levelKey)
        }
    }
}
