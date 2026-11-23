import SwiftUI

/// A quick word check while the article is being written (1.7, owner's idea).
/// Words come from the learner's own word bank (still learning, least practised first);
/// someone with fewer than 8 words gets starter words of their level (StarterWords.json).
/// Bank answers count as practice like the word quiz; starter answers are not saved.
/// Runs in the app only, so generation does not get slower.
struct WaitingWordQuiz: View {
    struct Item: Equatable {
        let id: Int?          // bank word id (nil = starter word)
        let word: String
        let sub: String?      // kanji for the Japanese course
        let meaning: String
    }

    @State private var items: [Item] = []
    @State private var index = 0
    @State private var options: [String] = []
    @State private var picked: String?
    @State private var right = 0
    @State private var asked = 0

    private var current: Item? { items.isEmpty ? nil : items[index % items.count] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L("While you wait: word check", "待っている間に、単語チェック"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.meadowLeaf)
                Spacer()
                if asked > 0 {
                    Text(L("\(right) / \(asked) right", "\(asked)問中 \(right)問正解"))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            if let item = current {
                VStack(spacing: 2) {
                    Text(item.word).font(.system(.title2, design: .rounded).weight(.bold))
                    if let sub = item.sub { Text(sub).font(.subheadline).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity)
                .id(index)
                .transition(.opacity)

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(options, id: \.self) { option in
                        Button { choose(option, for: item) } label: {
                            Text(option)
                                .font(.subheadline)
                                .lineLimit(2)
                                .minimumScaleFactor(0.8)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .padding(.horizontal, 6)
                                .background(background(option, item), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .disabled(picked != nil)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .padding(14)
        .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 16))
        .animation(.easeInOut(duration: 0.2), value: index)
        .task { await load() }
    }

    private func background(_ option: String, _ item: Item) -> Color {
        guard let picked else { return Color.appBackground }
        if option == item.meaning { return Color.green.opacity(0.25) }
        if option == picked { return Color.red.opacity(0.22) }
        return Color.appBackground
    }

    private func choose(_ option: String, for item: Item) {
        picked = option
        asked += 1
        let correct = option == item.meaning
        if correct { right += 1 }
        if let id = item.id {
            Task { _ = try? await APIClient.shared.recordTestResult(id: id, correct: correct, mode: "choice") }
        }
        Task {
            try? await Task.sleep(for: .seconds(correct ? 0.9 : 1.6))
            picked = nil
            index += 1
            makeOptions()
        }
    }

    private func makeOptions() {
        guard let item = current else { return }
        var seen: Set<String> = [item.meaning.lowercased()]
        var others: [String] = []
        for other in items.shuffled() where seen.insert(other.meaning.lowercased()).inserted {
            others.append(other.meaning)
            if others.count == 3 { break }
        }
        options = (others + [item.meaning]).shuffled()
    }

    private func load() async {
        guard items.isEmpty else { return }
        var bank: [Item] = []
        if let words = try? await APIClient.shared.fetchVocabulary(status: "learning", limit: 120).vocabulary {
            let isJa = LearningLanguage.current.isJapanese
            bank = words
                .sorted { ($0.timesTested ?? 0) < ($1.timesTested ?? 0) }   // least practised first
                .prefix(30)
                .map { Item(id: $0.id, word: $0.wordRomajiMacron, sub: isJa ? $0.wordKanji : nil,
                            meaning: VocabQuizViewModel.firstSense($0.meaningEn)) }
                .shuffled()
        }
        var list = bank
        if Set(bank.map(\.meaning)).count < 8 {
            let level = (try? await APIClient.shared.fetchConfig())?.proficiencyLevel ?? LearningLanguage.current.defaultLevel
            list = Self.starterWords(level: level).shuffled()
        }
        guard list.count >= 4 else { return }
        items = list
        makeOptions()
    }

    private struct Starter: Decodable { let w: String; let k: String?; let m: String }

    static func starterWords(level: String) -> [Item] {
        guard let url = Bundle.main.url(forResource: "StarterWords", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let all = try? JSONDecoder().decode([String: [String: [Starter]]].self, from: data),
              let course = all[LearningLanguage.current.rawValue] else { return [] }
        let rows = course[level] ?? course[LearningLanguage.current.levels.first ?? ""] ?? []
        return rows.map { Item(id: nil, word: $0.w, sub: $0.k, meaning: $0.m) }
    }
}
