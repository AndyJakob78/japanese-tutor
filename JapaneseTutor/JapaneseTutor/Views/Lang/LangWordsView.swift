import SwiftUI

/// The learner's word list for German / English: filter by status, search,
/// start a review, open the mistake notes.
struct LangWordsView: View {
    @State private var words: [LangWord] = []
    @State private var counts: [String: Int] = [:]
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var search = ""
    @State private var filter: String?
    @State private var selected: LangWord?
    @State private var showReview = false
    @State private var showMistakes = false

    private let statuses = ["new", "learning", "known", "mastered"]

    private var shown: [LangWord] {
        words.filter { w in
            (filter == nil || (w.status ?? "new") == filter) &&
            (search.isEmpty || w.base.localizedCaseInsensitiveContains(search) || w.meaning.contains(search))
        }
    }

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.footnote)
            }
            if !words.isEmpty {
                Section {
                    Button {
                        showReview = true
                    } label: {
                        Label("単語を復習する", systemImage: "pencil.and.list.clipboard")
                            .font(.headline)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip(nil, "すべて \(words.count)")
                            ForEach(statuses, id: \.self) { s in
                                chip(s, "\(LangWord.statusJa(s)) \(counts[s] ?? 0)")
                            }
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 0))
                }
            }
            ForEach(shown) { word in
                Button { selected = word } label: { LangWordRow(word: word) }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button("削除", role: .destructive) { Task { await delete(word) } }
                    }
            }
        }
        .overlay {
            if isLoading { ProgressView() }
            else if words.isEmpty && errorMessage == nil {
                ContentUnavailableView("単語はまだありません", systemImage: "character.book.closed", description: Text("記事を読むと、新しい単語がここに集まります。"))
            }
        }
        .searchable(text: $search, prompt: "単語を検索")
        .navigationTitle("単語")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showMistakes = true } label: { Label("間違いノート", systemImage: "exclamationmark.bubble") }
            }
        }
        .sheet(item: $selected) { word in
            LangWordCard(word: word, onStatusChange: { status in
                Task { await setStatus(word, status) }
            })
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showReview, onDismiss: { Task { await load() } }) {
            NavigationStack { LangReviewView() }
        }
        .sheet(isPresented: $showMistakes) {
            NavigationStack { LangMistakesView() }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func chip(_ status: String?, _ label: String) -> some View {
        Button { filter = status } label: {
            Text(label)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(filter == status ? Color.accentColor : Color(.secondarySystemBackground), in: Capsule())
                .foregroundStyle(filter == status ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        do {
            let response = try await APIClient.shared.fetchLangVocabulary()
            words = response.vocabulary
            counts = response.counts ?? [:]
            errorMessage = nil
        } catch {
            errorMessage = "単語を読み込めませんでした。"
        }
        isLoading = false
    }

    private func delete(_ word: LangWord) async {
        guard let id = word.wordId else { return }
        do {
            try await APIClient.shared.deleteLangWord(wordId: id)
            await load()
        } catch { errorMessage = "削除できませんでした。" }
    }

    private func setStatus(_ word: LangWord, _ status: String) async {
        guard let id = word.wordId else { return }
        try? await APIClient.shared.setLangWordStatus(wordId: id, status: status)
        selected = nil
        await load()
    }
}

struct LangWordRow: View {
    let word: LangWord

    private var statusColor: Color {
        switch word.status {
        case "learning": return .orange
        case "known": return .green
        case "mastered": return .blue
        default: return .gray
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(word.base).font(.headline)
                if !word.posJa.isEmpty {
                    Text(word.posJa).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(LangWord.statusJa(word.status))
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(statusColor.opacity(0.15), in: Capsule())
                    .foregroundStyle(statusColor)
            }
            Text(word.meaning).font(.subheadline)
            if let example = word.example, !example.isEmpty {
                Text(example).font(.footnote).foregroundStyle(.secondary).padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

// MARK: - Typed review

/// The learner sees the Japanese meaning and types the word. For German nouns
/// the article is asked for too: "die Regierung".
struct LangReviewView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var words: [LangWord] = []
    @State private var index = 0
    @State private var answer = ""
    @State private var result: Bool?
    @State private var articleMissing = false
    @State private var correctCount = 0
    @State private var isLoading = true
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().padding(.top, 80)
            } else if words.isEmpty {
                ContentUnavailableView("今は復習する単語がありません", systemImage: "checkmark.seal", description: Text("新しい記事を読むか、あとでもう一度確認してください。"))
                    .padding(.top, 60)
            } else if index >= words.count {
                VStack(spacing: 16) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(Color.accentColor).padding(.top, 40)
                    Text("\(words.count)語中 \(correctCount)語正解").font(.title2.bold())
                    Button("終わる") { dismiss() }.buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity)
                .padding()
            } else {
                card(words[index])
            }
        }
        .navigationTitle(words.isEmpty || index >= words.count ? "復習" : "復習 \(index + 1)/\(words.count)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
        .task {
            words = (try? await APIClient.shared.fetchLangReviewWords().words) ?? []
            isLoading = false
            focused = true
        }
    }

    @ViewBuilder
    private func card(_ word: LangWord) -> some View {
        let isNoun = word.article != nil
        VStack(alignment: .leading, spacing: 16) {
            Text(LearningLanguage.current == .german && isNoun ? "冠詞 (der / die / das) をつけて入力してください。" : "この意味の単語を入力してください。")
                .font(.subheadline).foregroundStyle(.secondary)
            Text(word.meaning).font(.title.bold())
            if !word.posJa.isEmpty { Text(word.posJa).font(.caption).foregroundStyle(.secondary) }

            TextField(isNoun ? "die …" : "単語", text: $answer)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.title3)
                .padding(14)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                .focused($focused)
                .disabled(result != nil)
                .onSubmit { if result == nil { check(word) } }

            if let result {
                VStack(alignment: .leading, spacing: 6) {
                    Text(result ? "正解です" : "不正解です").font(.headline).foregroundStyle(result ? .green : .red)
                    Text(word.base).font(.title3.weight(.semibold))
                    if result && articleMissing, let article = word.article {
                        Text("冠詞も覚えましょう: \(article)").font(.footnote).foregroundStyle(.orange)
                    }
                    if let example = word.example, !example.isEmpty {
                        Text(example).font(.callout).padding(.top, 4)
                        if let ja = word.exampleTranslation { Text(ja).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

                Button { next() } label: { Text("次へ").frame(maxWidth: .infinity).padding(.vertical, 6) }
                    .buttonStyle(.borderedProminent)
            } else {
                HStack {
                    Button("わからない") { answer = ""; check(word) }.buttonStyle(.bordered)
                    Spacer()
                    Button { check(word) } label: { Text("答える").padding(.horizontal, 12) }
                        .buttonStyle(.borderedProminent)
                        .disabled(answer.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .padding()
    }

    /// Lowercase, umlauts may be typed as ae / oe / ue / ss.
    static func normalize(_ text: String) -> String {
        text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "ä", with: "ae").replacingOccurrences(of: "ö", with: "oe")
            .replacingOccurrences(of: "ü", with: "ue").replacingOccurrences(of: "ß", with: "ss")
            .replacingOccurrences(of: "’", with: "'")
            .split(separator: " ").joined(separator: " ")
    }

    /// (correct, articleMissing). A German noun typed without article counts,
    /// with a reminder; a wrong article is wrong.
    static func judge(answer: String, headword: String, article: String?) -> (Bool, Bool) {
        let typed = normalize(answer), head = normalize(headword)
        guard !typed.isEmpty else { return (false, false) }
        if let article {
            if typed == "\(article) \(head)" { return (true, false) }
            if typed == head { return (true, true) }
            return (false, false)
        }
        return (typed == head || typed == "to \(head)", false)
    }

    private func check(_ word: LangWord) {
        let (ok, missing) = Self.judge(answer: answer, headword: word.headword ?? word.base, article: word.article)
        result = ok
        articleMissing = missing
        if ok { correctCount += 1 }
        focused = false
        if let id = word.wordId { Task { try? await APIClient.shared.recordLangTest(wordId: id, correct: ok) } }
    }

    private func next() {
        index += 1
        answer = ""
        result = nil
        articleMissing = false
        focused = true
    }
}

// MARK: - Statistics

struct LangStatsView: View {
    @State private var stats: LangStats?
    @State private var failed = false

    var body: some View {
        List {
            if let stats {
                Section {
                    HStack {
                        tile("\(stats.streak)日", "連続学習", "flame.fill", .orange)
                        tile("\(stats.articles.read)", "読んだ記事", "doc.text.fill", .blue)
                        tile(stats.quiz.averageScore.map { "\($0)%" } ?? "–", "クイズ平均", "checkmark.circle.fill", .green)
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
                Section("単語 (\(stats.vocabulary.total)語)") {
                    row("新しい", stats.vocabulary.byStatus.new, .gray, stats.vocabulary.total)
                    row("学習中", stats.vocabulary.byStatus.learning, .orange, stats.vocabulary.total)
                    row("覚えた", stats.vocabulary.byStatus.known, .green, stats.vocabulary.total)
                    row("完璧", stats.vocabulary.byStatus.mastered, .blue, stats.vocabulary.total)
                    LabeledContent("今日の復習", value: "\(stats.vocabulary.dueForReview)語")
                }
                Section("記事") {
                    LabeledContent("作成した記事", value: "\(stats.articles.total)")
                    LabeledContent("読んだ記事", value: "\(stats.articles.read)")
                    LabeledContent("クイズをした記事", value: "\(stats.articles.quizzed)")
                }
            } else if failed {
                Text("統計を読み込めませんでした。").foregroundStyle(.red).font(.footnote)
            }
        }
        .overlay { if stats == nil && !failed { ProgressView() } }
        .navigationTitle("統計")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { stats = try await APIClient.shared.fetchLangStats(); failed = false } catch { failed = true }
    }

    private func tile(_ value: String, _ label: String, _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).foregroundStyle(color)
            Text(value).font(.title2.bold())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 4)
    }

    private func row(_ label: String, _ count: Int, _ color: Color, _ total: Int) -> some View {
        HStack {
            Text(label)
            Spacer()
            ProgressView(value: total > 0 ? Double(count) / Double(total) : 0).tint(color).frame(width: 110)
            Text("\(count)").font(.callout.monospacedDigit()).frame(width: 36, alignment: .trailing)
        }
    }
}
