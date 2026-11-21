import SwiftUI

@Observable
class LangFeedViewModel {
    var articles: [LangArticle] = []
    var isLoading = true
    var isGenerating = false
    var generationStartedAt: Date?
    var errorMessage: String?
    var showPaywall = false
    var newArticle: LangArticle?

    func load() async {
        do {
            articles = try await APIClient.shared.fetchLangArticles().articles
            errorMessage = nil
        } catch {
            errorMessage = "記事を読み込めませんでした。"
        }
        isLoading = false
    }

    func generate() async {
        guard !isGenerating else { return }
        isGenerating = true
        generationStartedAt = Date()
        errorMessage = nil
        let level = UserDefaults.standard.string(forKey: LearningLanguage.current.levelKey) ?? "A1-A2"
        do {
            let article = try await APIClient.shared.generateLangArticle(level: level, topic: LangTopics.next())
            await load()
            newArticle = article
        } catch APIError.trialExhausted {
            showPaywall = true
        } catch {
            errorMessage = "記事を作成できませんでした。もう一度お試しください。"
            await load() // the article may have been saved even if the connection dropped
        }
        isGenerating = false
    }

    func delete(_ article: LangArticle) async {
        do {
            try await APIClient.shared.deleteLangArticle(id: article.id)
            articles.removeAll { $0.id == article.id }
        } catch {
            errorMessage = "削除できませんでした。"
        }
    }
}

struct LangFeedView: View {
    @State private var viewModel = LangFeedViewModel()
    private let language = LearningLanguage.current

    var body: some View {
        List {
            if let message = viewModel.errorMessage {
                Text(message).foregroundStyle(.red).font(.footnote)
            }
            ForEach(viewModel.articles) { article in
                NavigationLink(value: article.id) {
                    LangArticleRow(article: article)
                }
                .swipeActions {
                    Button("削除", role: .destructive) { Task { await viewModel.delete(article) } }
                }
            }
        }
        .overlay {
            if viewModel.isLoading { ProgressView() }
            else if viewModel.articles.isEmpty && !viewModel.isGenerating && viewModel.errorMessage == nil {
                ContentUnavailableView {
                    Label("記事はまだありません", systemImage: "newspaper")
                } description: {
                    Text("今日のニュースから、あなたのレベルに合った\(language.nameJa)の記事を作ります。")
                } actions: {
                    Button("最初の記事を作成") { Task { await viewModel.generate() } }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if viewModel.isGenerating {
                LangGeneratingBar(startedAt: viewModel.generationStartedAt ?? Date())
            }
        }
        .navigationTitle("\(language.nameJa)ニュース")
        .navigationDestination(for: Int.self) { id in
            LangArticleView(articleId: id)
        }
        .navigationDestination(item: $viewModel.newArticle) { article in
            LangArticleView(articleId: article.id, preloaded: article)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await viewModel.generate() }
                } label: {
                    Label("新しい記事", systemImage: "plus")
                }
                .disabled(viewModel.isGenerating)
            }
        }
        .sheet(isPresented: $viewModel.showPaywall) {
            PaywallView(onUpgradeSuccess: { viewModel.showPaywall = false })
        }
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }
}

extension LangArticle: Hashable {
    static func == (a: LangArticle, b: LangArticle) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct LangArticleRow: View {
    let article: LangArticle

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(article.title)
                .font(.headline)
                .foregroundStyle(article.readAt == nil ? .primary : .secondary)
            if let summary = article.summary {
                Text(summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 10) {
                if let level = article.level { Text(level).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor) }
                Text(article.dateJa)
                if let words = article.wordCount { Text("\(words)語") }
                if let new = article.newWordCount { Text("新出\(new)語") }
                Spacer()
                if let score = article.quizScore {
                    Label("\(Int(score))%", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

/// Shown at the bottom while an article is being written (about a minute).
struct LangGeneratingBar: View {
    let startedAt: Date

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
            let seconds = Int(context.date.timeIntervalSince(startedAt))
            HStack(spacing: 12) {
                ProgressView()
                VStack(alignment: .leading, spacing: 2) {
                    Text("記事を作成しています…").font(.subheadline.weight(.semibold))
                    Text(seconds < 25 ? "ニュースを探しています" : seconds < 60 ? "記事を書いています" : "仕上げています")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(seconds)秒").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal)
            .padding(.bottom, 6)
        }
    }
}
