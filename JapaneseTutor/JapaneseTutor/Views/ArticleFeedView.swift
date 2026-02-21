import SwiftUI

@Observable
class ArticleFeedViewModel {
    var articles: [Article] = []
    var isLoading = false
    var isGenerating = false
    var errorMessage: String?

    func loadArticles() async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await APIClient.shared.fetchArticles()
            articles = response.articles
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func generateArticle(proficiencyLevel: String? = nil, topic: String? = nil, newWordsCount: Int? = nil, targetWordCount: Int? = nil, writingSystem: String? = nil) async {
        isGenerating = true
        errorMessage = nil
        do {
            let newArticle = try await APIClient.shared.generateArticle(
                proficiencyLevel: proficiencyLevel,
                topic: topic,
                newWordsCount: newWordsCount,
                targetWordCount: targetWordCount,
                writingSystem: writingSystem
            )
            articles.insert(newArticle, at: 0)
        } catch {
            errorMessage = error.localizedDescription
        }
        isGenerating = false
    }

    func deleteArticle(id: Int, deleteVocabulary: Bool) async {
        do {
            try await APIClient.shared.deleteArticle(id: id, deleteVocabulary: deleteVocabulary)
            articles.removeAll { $0.id == id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ArticleFeedView: View {
    @State private var viewModel = ArticleFeedViewModel()
    @State private var showGenerateSheet = false
    @State private var articleToDelete: Article?
    @State private var showDeleteConfirmation = false

    var body: some View {
        ZStack {
            List {
                ForEach(viewModel.articles) { article in
                    NavigationLink(destination: ArticleDetailView(articleId: article.id)) {
                        ArticleCard(article: article)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            articleToDelete = article
                            showDeleteConfirmation = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .listStyle(.plain)
            .refreshable {
                await viewModel.loadArticles()
            }
            .overlay {
                if viewModel.articles.isEmpty && !viewModel.isLoading {
                    ContentUnavailableView(
                        "No Articles Yet",
                        systemImage: "doc.text",
                        description: Text("Tap + to generate your first article")
                    )
                }
            }

            // Floating generate button
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Button {
                        showGenerateSheet = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(Color.accentColor)
                            .clipShape(Circle())
                            .shadow(radius: 4, y: 2)
                    }
                    .padding(.trailing, 20)
                    .padding(.bottom, 20)
                }
            }
        }
        .navigationTitle("Articles")
        .task {
            await viewModel.loadArticles()
        }
        .sheet(isPresented: $showGenerateSheet) {
            GenerateArticleSheet(viewModel: viewModel)
        }
        .alert("Error", isPresented: .init(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .confirmationDialog(
            "Delete Article",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete article only", role: .destructive) {
                if let article = articleToDelete {
                    Task { await viewModel.deleteArticle(id: article.id, deleteVocabulary: false) }
                }
            }
            Button("Delete article and its vocabulary", role: .destructive) {
                if let article = articleToDelete {
                    Task { await viewModel.deleteArticle(id: article.id, deleteVocabulary: true) }
                }
            }
            Button("Cancel", role: .cancel) {
                articleToDelete = nil
            }
        } message: {
            if let article = articleToDelete {
                Text("Delete \"\(stripMarkers(article.titleRomaji))\"?\n\nYou can keep the vocabulary words for future review or delete them too.")
            }
        }
    }
}

struct GenerateArticleSheet: View {
    @Bindable var viewModel: ArticleFeedViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var selectedLevel = "N3"
    @State private var topicOverride = ""
    @State private var newWordsCount = 12
    @State private var targetWordCount = 200
    @State private var selectedWritingSystem = "romaji"
    @State private var configLoaded = false

    let levels = ["N5", "N4", "N3", "N2", "N1"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Writing System") {
                    Picker("Writing System", selection: $selectedWritingSystem) {
                        Text("Romaji").tag("romaji")
                        Text("\u{3072}\u{3089}\u{304C}\u{306A}").tag("kana")
                        Text("\u{6F22}\u{5B57}").tag("kanji")
                    }
                    .pickerStyle(.segmented)
                }

                Section("JLPT Level") {
                    Picker("Level", selection: $selectedLevel) {
                        ForEach(levels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Article Length") {
                    Stepper("\(targetWordCount) words", value: $targetWordCount, in: 100...500, step: 50)
                }

                Section("New Words") {
                    Stepper("\(newWordsCount) new words", value: $newWordsCount, in: 5...25)
                }

                Section("Topic (Optional)") {
                    TextField("e.g., Germany economy, Japan technology", text: $topicOverride)
                }

                Section {
                    Button {
                        Task {
                            let topic = topicOverride.isEmpty ? nil : topicOverride
                            await viewModel.generateArticle(
                                proficiencyLevel: selectedLevel,
                                topic: topic,
                                newWordsCount: newWordsCount,
                                targetWordCount: targetWordCount,
                                writingSystem: selectedWritingSystem
                            )
                            if viewModel.errorMessage == nil {
                                dismiss()
                            }
                        }
                    } label: {
                        if viewModel.isGenerating {
                            HStack {
                                ProgressView()
                                    .padding(.trailing, 8)
                                Text("Generating article...")
                            }
                        } else {
                            Label("Generate Article", systemImage: "sparkles")
                        }
                    }
                    .disabled(viewModel.isGenerating)
                }

                if viewModel.isGenerating {
                    Section {
                        Text("The AI is searching for news, writing the article, extracting vocabulary, and creating quiz questions. This may take a few minutes.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("New Article")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(viewModel.isGenerating)
                }
            }
            .task {
                if !configLoaded {
                    if let config = try? await APIClient.shared.fetchConfig() {
                        selectedLevel = config.proficiencyLevel
                        newWordsCount = config.newWordsPerArticle
                        targetWordCount = config.targetWordCount
                        selectedWritingSystem = config.writingSystem
                    }
                    configLoaded = true
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ArticleFeedView()
    }
}
