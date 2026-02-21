import SwiftUI

/// Strips [NEW] and [REVIEW] markers from display text (summaries, titles, etc.)
func stripMarkers(_ text: String) -> String {
    text.replacingOccurrences(of: "[NEW]", with: "")
        .replacingOccurrences(of: "[REVIEW]", with: "")
        .replacingOccurrences(of: "  ", with: " ")
        .trimmingCharacters(in: .whitespaces)
}

@Observable
class ArticleDetailViewModel {
    var article: Article?
    var isLoading = false
    var errorMessage: String?
    var showTranslation = false
    var selectedWord: VocabularyWord?
    var fontSize: CGFloat = 17
    var showWordLookup = false
    var lookupQuery = ""

    /// Search vocabulary words for the current article
    var filteredVocabulary: [VocabularyWord] {
        guard !lookupQuery.isEmpty, let vocab = article?.vocabulary else { return [] }
        let q = lookupQuery.lowercased()
        return vocab.filter {
            $0.wordRomajiMacron.lowercased().contains(q) ||
            $0.wordRomaji.lowercased().contains(q) ||
            $0.meaningEn.lowercased().contains(q) ||
            ($0.wordKana?.lowercased().contains(q) ?? false) ||
            ($0.wordKanji?.lowercased().contains(q) ?? false)
        }
    }

    func loadArticle(id: Int) async {
        isLoading = true
        do {
            article = try await APIClient.shared.fetchArticle(id: id)
            // Mark as read
            try? await APIClient.shared.markArticleRead(id: id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct ArticleDetailView: View {
    let articleId: Int
    @State private var viewModel = ArticleDetailViewModel()

    var body: some View {
        ScrollView {
            if viewModel.isLoading {
                ProgressView("Loading article...")
                    .padding(.top, 100)
            } else if let article = viewModel.article {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    articleHeader(article)

                    Divider()

                    // Article body — fully selectable, native iOS text selection
                    articleBody(article)

                    // Translation toggle
                    if let translation = article.translationEn {
                        translationSection(translation)
                    }

                    // Grammar points
                    if let points = article.grammarPoints, !points.isEmpty {
                        grammarSection(points)
                    }

                    // Vocabulary section
                    if let vocab = article.vocabulary, !vocab.isEmpty {
                        vocabularySection(vocab, writingSystem: article.writingSystem ?? "romaji")
                    }

                    // Quiz button
                    NavigationLink(destination: QuizView(articleId: article.id)) {
                        Label("Take Quiz", systemImage: "questionmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.accentColor)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(.top, 8)

                    // Sources
                    if let sources = article.sources, !sources.isEmpty {
                        sourcesSection(sources)
                    }
                }
                .padding()
            } else if let error = viewModel.errorMessage {
                Text("Error: \(error)")
                    .foregroundStyle(.red)
                    .padding()
            }
        }
        .navigationTitle("Article")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    // Word lookup button
                    Button {
                        viewModel.showWordLookup = true
                    } label: {
                        Image(systemName: "character.book.closed")
                    }

                    // Text size menu
                    Menu {
                        Button { viewModel.fontSize = max(14, viewModel.fontSize - 2) } label: {
                            Label("Smaller Text", systemImage: "textformat.size.smaller")
                        }
                        Button { viewModel.fontSize = min(28, viewModel.fontSize + 2) } label: {
                            Label("Larger Text", systemImage: "textformat.size.larger")
                        }
                        Button { viewModel.fontSize = 17 } label: {
                            Label("Default Size", systemImage: "arrow.counterclockwise")
                        }
                    } label: {
                        Image(systemName: "textformat.size")
                    }
                }
            }
        }
        .task {
            await viewModel.loadArticle(id: articleId)
        }
        .sheet(item: $viewModel.selectedWord) { word in
            WordDetailSheet(word: word)
        }
        .sheet(isPresented: $viewModel.showWordLookup) {
            WordLookupSheet(viewModel: viewModel)
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func articleHeader(_ article: Article) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            // Title
            Text(stripMarkers(article.titleRomaji))
                .font(.title2.weight(.bold))

            // Summary — no line limit, SKILL.md controls length
            if let summary = article.summaryRomaji {
                Text(stripMarkers(summary))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Metadata row — clean, no bubbles
            HStack(spacing: 6) {
                if let region = article.region {
                    Text(regionFlag(region))
                        .font(.caption)
                }
                if let topic = article.topic {
                    Text(topic.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if let count = article.newWordCount, count > 0 {
                    Text("\(count) new words")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    private func regionFlag(_ region: String) -> String {
        switch region.lowercased() {
        case "germany": return "🇩🇪"
        case "japan": return "🇯🇵"
        case "us", "usa": return "🇺🇸"
        case "uk": return "🇬🇧"
        case "france": return "🇫🇷"
        case "china": return "🇨🇳"
        case "korea", "south korea": return "🇰🇷"
        default: return "🌍"
        }
    }

    @ViewBuilder
    private func articleBody(_ article: Article) -> some View {
        if let body = article.bodyRomaji {
            TappableRomajiText(
                text: body,
                vocabulary: article.vocabulary ?? [],
                writingSystem: article.writingSystem ?? "romaji",
                fontSize: viewModel.fontSize,
                onWordTap: { word in
                    viewModel.selectedWord = word
                }
            )
        }
    }

    @ViewBuilder
    private func translationSection(_ translation: String) -> some View {
        DisclosureGroup(isExpanded: $viewModel.showTranslation) {
            Text(translation)
                .font(.body)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        } label: {
            Label("English Translation", systemImage: "globe")
                .font(.headline)
        }
    }

    @ViewBuilder
    private func grammarSection(_ points: [GrammarPoint]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Grammar Points")
                .font(.headline)

            ForEach(Array(points.enumerated()), id: \.offset) { _, point in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(point.pattern)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                        Text(point.level)
                            .font(.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.1))
                            .clipShape(Capsule())
                    }
                    Text(point.explanation)
                        .font(.subheadline)
                    if let examples = point.examples {
                        ForEach(examples, id: \.self) { example in
                            Text("  \(example)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    @ViewBuilder
    private func vocabularySection(_ vocab: [VocabularyWord], writingSystem ws: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Vocabulary")
                .font(.headline)

            let newWords = vocab.filter { $0.isNew?.value == true }
            let reviewWords = vocab.filter { $0.isReview?.value == true }

            if !newWords.isEmpty {
                Text("New Words")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.orange)

                ForEach(newWords) { word in
                    Button {
                        viewModel.selectedWord = word
                    } label: {
                        VocabularyCard(word: word, writingSystem: ws)
                    }
                    .buttonStyle(.plain)
                }
            }

            if !reviewWords.isEmpty {
                Text("Review Words")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.blue)
                    .padding(.top, 4)

                ForEach(reviewWords) { word in
                    Button {
                        viewModel.selectedWord = word
                    } label: {
                        VocabularyCard(word: word, writingSystem: ws)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func sourcesSection(_ sources: [Source]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Sources")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                Text(source.name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 8)
    }
}

// MARK: - Word Detail Sheet

struct WordDetailSheet: View {
    let word: VocabularyWord
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Romaji", value: word.wordRomajiMacron)
                    if let kanji = word.wordKanji {
                        LabeledContent("Kanji", value: kanji)
                    }
                    if let kana = word.wordKana {
                        LabeledContent("Reading", value: kana)
                    }
                    LabeledContent("Meaning", value: word.meaningEn)
                }

                Section {
                    if let pos = word.partOfSpeech {
                        LabeledContent("Part of Speech", value: pos)
                    }
                    if let level = word.jlptLevel {
                        LabeledContent("JLPT Level", value: level)
                    }
                    if let cat = word.category {
                        LabeledContent("Category", value: cat.capitalized)
                    }
                    LabeledContent("Status", value: word.status.capitalized)
                }

                if let context = word.contextSentence {
                    Section("Context") {
                        Text(context)
                            .font(.subheadline)
                    }
                }

                Section {
                    LabeledContent("Times Seen", value: "\(word.timesSeen ?? 0)")
                    LabeledContent("Times Tested", value: "\(word.timesTested ?? 0)")
                    LabeledContent("Correct", value: "\(word.timesTestedCorrect ?? 0)")
                }
            }
            .navigationTitle(word.wordRomajiMacron)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Word Lookup Sheet

struct WordLookupSheet: View {
    @Bindable var viewModel: ArticleDetailViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if viewModel.lookupQuery.isEmpty {
                    // Show all vocabulary when no search
                    let vocab = viewModel.article?.vocabulary ?? []
                    let newWords = vocab.filter { $0.isNew?.value == true }
                    let reviewWords = vocab.filter { $0.isReview?.value == true }

                    if !newWords.isEmpty {
                        Section("New Words") {
                            ForEach(newWords) { word in
                                wordRow(word)
                            }
                        }
                    }
                    if !reviewWords.isEmpty {
                        Section("Review Words") {
                            ForEach(reviewWords) { word in
                                wordRow(word)
                            }
                        }
                    }
                } else {
                    // Show search results
                    let results = viewModel.filteredVocabulary
                    if results.isEmpty {
                        ContentUnavailableView.search(text: viewModel.lookupQuery)
                    } else {
                        ForEach(results) { word in
                            wordRow(word)
                        }
                    }
                }
            }
            .navigationTitle("Word Lookup")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $viewModel.lookupQuery, prompt: "Search words or meanings...")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func wordRow(_ word: VocabularyWord) -> some View {
        let ws = viewModel.article?.writingSystem ?? "romaji"
        Button {
            dismiss()
            // Small delay so dismiss animation completes before showing detail
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                viewModel.selectedWord = word
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(primaryWordText(word, writingSystem: ws))
                        .font(.body.weight(.medium))
                    if ws != "romaji" {
                        Text(word.wordRomajiMacron)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Text(word.meaningEn)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let pos = word.partOfSpeech {
                    Text(pos)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(.systemGray5))
                        .clipShape(Capsule())
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// Returns the primary display text for a word based on writing system
    private func primaryWordText(_ word: VocabularyWord, writingSystem: String) -> String {
        switch writingSystem {
        case "kanji":
            if let kanji = word.wordKanji, let kana = word.wordKana {
                return "\(kanji)（\(kana)）"
            }
            return word.wordKana ?? word.wordRomajiMacron
        case "kana":
            return word.wordKana ?? word.wordRomajiMacron
        default:
            return word.wordRomajiMacron
        }
    }
}

#Preview {
    NavigationStack {
        ArticleDetailView(articleId: 1)
    }
}
