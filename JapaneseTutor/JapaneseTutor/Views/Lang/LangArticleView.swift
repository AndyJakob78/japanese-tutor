import SwiftUI

struct LangArticleView: View {
    let articleId: Int
    var preloaded: LangArticle? = nil

    @State private var article: LangArticle?
    @State private var errorMessage: String?
    @State private var showTranslation = false
    @State private var selectedWord: LangWord?
    @State private var lookup: LangLookup?
    @State private var lookingUp: String?
    @State private var showQuiz = false
    @State private var showPractice = false
    @State private var showAudio = false
    @State private var speaker = ArticleSpeaker()

    var body: some View {
        ScrollView {
            if let article {
                content(article)
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).padding()
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    guard let article, let body = article.body else { return }
                    showAudio = true
                    Task {
                        speaker.language = LearningLanguage.current.rawValue
                        await speaker.load(articleId: article.id, body: LangArticleText.plain(body))
                        if !speaker.isPlaying { speaker.playPause() }
                    }
                } label: {
                    Label("読み上げ", systemImage: "speaker.wave.2")
                }
                .disabled(article == nil)
            }
        }
        .safeAreaInset(edge: .top) {
            if showAudio { ArticleAudioBar(speaker: speaker) { showAudio = false } }
        }
        .overlay(alignment: .bottom) {
            if let lookingUp {
                HStack(spacing: 8) { ProgressView(); Text("「\(lookingUp)」を調べています…").font(.footnote) }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 12)
            }
        }
        .onDisappear { speaker.stop() }
        .task { await load() }
        .sheet(item: $selectedWord) { word in
            LangWordCard(word: word)
                .presentationDetents([.height(300), .medium])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $lookup) { entry in
            LangLookupCard(entry: entry, articleId: articleId)
                .presentationDetents([.height(360), .medium])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showQuiz) {
            if let article, let quiz = article.quiz {
                NavigationStack {
                    LangQuizView(articleId: article.id, questions: quiz) { await load(force: true) }
                }
            }
        }
        .sheet(isPresented: $showPractice) {
            if let article { NavigationStack { LangPracticeView(article: article) } }
        }
    }

    @ViewBuilder
    private func content(_ article: LangArticle) -> some View {
        let words = article.vocabulary ?? []
        let review = article.reviewVocabulary ?? []
        let paragraphs = paragraphs(article.body)
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                if let level = article.level { Text(level).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor) }
                Text(article.dateJa)
                if let count = article.wordCount { Text("\(count)語") }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            Text(article.title).font(.title2.bold())

            // The article. New words (blue) and review words (orange) open their
            // card; any other word can be tapped to look it up.
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                Text(LangArticleText.attributed(paragraph, paragraph: index, words: words, review: review))
                    .font(.system(size: 19))
                    .lineSpacing(7)
            }
            .environment(\.openURL, OpenURLAction { url in
                handleTap(url, words: words, review: review, paragraphs: paragraphs)
                return .handled
            })
            .tint(.primary)

            Text("青は新しい単語、オレンジは復習の単語です。ほかの単語もタップすると意味を調べられます。")
                .font(.caption).foregroundStyle(.secondary)

            // Japanese translation, hidden until asked for
            DisclosureGroup(isExpanded: $showTranslation) {
                Text(article.translation ?? "")
                    .font(.callout)
                    .lineSpacing(5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
            } label: {
                Label("日本語訳", systemImage: "text.bubble").font(.headline)
            }
            .padding(14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))

            if let note = article.grammarNote {
                VStack(alignment: .leading, spacing: 8) {
                    Label("文法", systemImage: "text.book.closed").font(.headline)
                    Text(note.point).font(.subheadline.weight(.semibold))
                    Text(note.explanation).font(.callout)
                    if let sentence = note.sentence {
                        Text(sentence).font(.callout).italic().foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
            }

            if !words.isEmpty { wordSection("新しい単語 (\(words.count))", words) }
            if !review.isEmpty { wordSection("復習の単語 (\(review.count))", review) }

            if let quiz = article.quiz, !quiz.isEmpty {
                Button {
                    showQuiz = true
                } label: {
                    HStack {
                        Image(systemName: "questionmark.circle.fill")
                        Text(article.quizScore == nil ? "クイズに挑戦 (\(quiz.count)問)" : "もう一度クイズ (前回 \(Int(article.quizScore ?? 0))%)")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
            }
            if !words.isEmpty || !review.isEmpty {
                Button {
                    showPractice = true
                } label: {
                    HStack { Image(systemName: "pencil.line"); Text("文を作る") }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
            }

            if let sources = article.sources, !sources.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("出典").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                        if let urlString = source.url, let url = URL(string: urlString) {
                            Link(source.source ?? urlString, destination: url).font(.caption)
                        } else {
                            Text(source.source ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .environment(\.openURL, OpenURLAction { _ in .systemAction })
            }
        }
        .padding()
    }

    private func wordSection(_ title: String, _ list: [LangWord]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: "character.book.closed").font(.headline)
            ForEach(list) { word in
                Button { selectedWord = word } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text(word.base).font(.callout.weight(.semibold))
                        Spacer(minLength: 12)
                        Text(word.meaning).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                Divider()
            }
        }
    }

    private func handleTap(_ url: URL, words: [LangWord], review: [LangWord], paragraphs: [String]) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let index = Int(parts.queryItems?.first { $0.name == "i" }?.value ?? "") ?? -1
        switch url.host {
        case "new": if words.indices.contains(index) { selectedWord = words[index] }
        case "review": if review.indices.contains(index) { selectedWord = review[index] }
        case "lookup":
            guard let word = parts.queryItems?.first(where: { $0.name == "w" })?.value, lookingUp == nil else { return }
            let sentence = paragraphs.indices.contains(index) ? LangArticleText.sentence(containing: word, in: LangArticleText.plain(paragraphs[index])) : word
            lookingUp = word
            Task {
                lookup = try? await APIClient.shared.lookupLangWord(word, sentence: sentence)
                lookingUp = nil
            }
        default: break
        }
    }

    private func paragraphs(_ body: String?) -> [String] {
        (body ?? "").components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private func load(force: Bool = false) async {
        if article == nil, let preloaded, !force { article = preloaded }
        do {
            if article == nil || force { article = try await APIClient.shared.fetchLangArticle(id: articleId) }
            if article?.readAt == nil { try? await APIClient.shared.markLangArticleRead(id: articleId) }
        } catch {
            errorMessage = "記事を読み込めませんでした。"
        }
    }
}

enum LangArticleText {
    /// The text without the [NEW] / [REVIEW] markers.
    static func plain(_ text: String) -> String {
        text.replacing(/\[(?:NEW|REVIEW)\]\s*/, with: "")
    }

    static func sentence(containing word: String, in paragraph: String) -> String {
        var found = paragraph
        paragraph.enumerateSubstrings(in: paragraph.startIndex..., options: .bySentences) { s, _, _, stop in
            if let s, s.contains(word) { found = s.trimmingCharacters(in: .whitespacesAndNewlines); stop = true }
        }
        return found
    }

    /// Every word becomes tappable. "[NEW] Regierung" is highlighted in blue,
    /// "[REVIEW] Gesetz" in orange, and both open their card; any other word
    /// is looked up when tapped.
    static func attributed(_ text: String, paragraph: Int, words: [LangWord], review: [LangWord]) -> AttributedString {
        var out = AttributedString()
        let token = /(\[(NEW|REVIEW)\]\s*)?([\p{L}][\p{L}'’\-]*)/
        var rest = text[...]
        while let match = rest.firstMatch(of: token) {
            out += AttributedString(String(rest[rest.startIndex..<match.range.lowerBound]))
            let word = String(match.3)
            var piece = AttributedString(word)
            let first: (LangWord) -> Bool = { ($0.word.split(separator: " ").first.map(String.init) ?? "").lowercased() == word.lowercased() }
            if match.2 == "NEW", let i = words.firstIndex(where: first) {
                piece.link = URL(string: "langword://new?i=\(i)")
                piece.foregroundColor = .blue
                piece.font = .system(size: 19, weight: .semibold)
                piece.underlineStyle = Text.LineStyle(pattern: .dot)
            } else if match.2 == "REVIEW", let i = review.firstIndex(where: { r in
                let head = (r.headword ?? r.base).lowercased()
                return word.lowercased().hasPrefix(String(head.prefix(4)))
            }) {
                piece.link = URL(string: "langword://review?i=\(i)")
                piece.foregroundColor = .orange
                piece.font = .system(size: 19, weight: .semibold)
                piece.underlineStyle = Text.LineStyle(pattern: .dot)
            } else if word.count >= 2 {
                var parts = URLComponents()
                parts.scheme = "langword"
                parts.host = "lookup"
                parts.queryItems = [URLQueryItem(name: "w", value: word), URLQueryItem(name: "i", value: String(paragraph))]
                piece.link = parts.url
            }
            out += piece
            rest = rest[match.range.upperBound...]
        }
        out += AttributedString(String(rest))
        return out
    }
}

struct LangWordCard: View {
    let word: LangWord
    /// Set in the word list: lets the learner change the status by hand.
    var onStatusChange: ((String) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(word.base).font(.title2.bold())
                if !word.posJa.isEmpty { Text(word.posJa).font(.caption).foregroundStyle(.secondary) }
            }
            Text(word.meaning).font(.title3)
            if let example = word.example, !example.isEmpty {
                Divider()
                Text(example).font(.body)
                if let ja = word.exampleTranslation, !ja.isEmpty {
                    Text(ja).font(.callout).foregroundStyle(.secondary)
                }
            }
            if let onStatusChange {
                Divider()
                Text("状態").font(.caption).foregroundStyle(.secondary)
                Picker("状態", selection: Binding(get: { word.status ?? "new" }, set: { onStatusChange($0) })) {
                    ForEach(["new", "learning", "known", "mastered"], id: \.self) { Text(LangWord.statusJa($0)).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
    }
}

/// A word the learner tapped that is not in the article's word list.
struct LangLookupCard: View {
    let entry: LangLookup
    let articleId: Int
    @State private var added = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.base).font(.title2.bold())
                Text(LangWord(word: entry.word, base: entry.base, pos: entry.pos, meaning: entry.meaning, example: nil, exampleTranslation: nil, wordId: nil, timesSeen: nil, lastSeenAt: nil, status: nil, article: nil, headword: nil, timesTested: nil, streakCorrect: nil).posJa)
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text(entry.meaning).font(.title3).fixedSize(horizontal: false, vertical: true)
            if let note = entry.note, !note.isEmpty {
                Text(note).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let example = entry.example, !example.isEmpty {
                Divider()
                Text(example).font(.body)
                if let ja = entry.exampleTranslation, !ja.isEmpty {
                    Text(ja).font(.callout).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if entry.pos != "name" {
                if entry.vocabularyId != nil || added {
                    Label("単語帳に入っています", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.subheadline)
                } else {
                    Button {
                        Task {
                            do { _ = try await APIClient.shared.addLangWord(entry, articleId: articleId); added = true }
                            catch { failed = true }
                        }
                    } label: {
                        Label("単語帳に追加", systemImage: "plus.circle").frame(maxWidth: .infinity).padding(.vertical, 4)
                    }
                    .buttonStyle(.borderedProminent)
                    if failed { Text("追加できませんでした。").font(.footnote).foregroundStyle(.red) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
    }
}
