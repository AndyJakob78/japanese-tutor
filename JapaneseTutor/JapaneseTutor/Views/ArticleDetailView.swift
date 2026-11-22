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

    /// Fetch again without the loading screen (after a word was added).
    func reloadQuietly(id: Int) async {
        if let fresh = try? await APIClient.shared.fetchArticle(id: id) { article = fresh }
    }
}

struct ArticleDetailView: View {
    let articleId: Int
    @State private var viewModel = ArticleDetailViewModel()
    @State private var speaker = ArticleSpeaker()
    @State private var showAudio = false

    var body: some View {
        ScrollView {
            if viewModel.isLoading {
                ProgressView(L("Loading article...", "記事を読み込んでいます…"))
                    .padding(.top, 100)
            } else if let article = viewModel.article {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    articleHeader(article)

                    Divider()

                    // Article body — fully selectable, native iOS text selection
                    articleBody(article)

                    // Quiz button — prominent, right after reading
                    NavigationLink(destination: QuizView(articleId: article.id)) {
                        HStack(spacing: 10) {
                            Image(systemName: "brain.head.profile")
                                .font(.title2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Test Your Knowledge", "クイズに挑戦"))
                                    .font(.headline)
                                Text(L("Take the vocabulary quiz for this article", "この記事の内容と単語を確認しましょう"))
                                    .font(.caption)
                                    .opacity(0.85)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .opacity(0.7)
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .padding(.top, 4)

                    // Sentence building — write your own sentences with the article's words
                    if (article.writingSystem ?? "romaji") == "romaji", (article.vocabulary?.count ?? 0) >= 2 {
                        NavigationLink(destination: SentencePracticeView(article: article)) {
                            HStack(spacing: 10) {
                                Image(systemName: "pencil.and.list.clipboard")
                                    .font(.title2)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Build Sentences", "文を作る"))
                                        .font(.headline)
                                    Text(L("Write your own sentences with these words", "記事の単語を使って自分で文を書きましょう"))
                                        .font(.caption)
                                        .opacity(0.85)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .opacity(0.7)
                            }
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.accentColor.opacity(0.12))
                            .foregroundStyle(Color.accentColor)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                        }
                    }

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

                }
                .padding()
            } else if let error = viewModel.errorMessage {
                Text(L("Error: \(error)", "エラー: \(error)"))
                    .foregroundStyle(.red)
                    .padding()
            }
        }
        .navigationTitle(L("Article", "記事"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    // Listen — on-device Japanese voice
                    Button {
                        if let article = viewModel.article, let body = article.bodyRomaji {
                            showAudio = true
                            Task {
                                await speaker.load(articleId: article.id, body: body)
                                if !speaker.isPlaying { speaker.playPause() }
                            }
                        }
                    } label: {
                        Image(systemName: "speaker.wave.2")
                    }
                    .accessibilityLabel(L("Listen", "読み上げ"))

                    // Quiz button — always accessible
                    NavigationLink(destination: QuizView(articleId: articleId)) {
                        Image(systemName: "brain.head.profile")
                    }

                    // Word lookup button
                    Button {
                        viewModel.showWordLookup = true
                    } label: {
                        Image(systemName: "character.book.closed")
                    }

                    // Text size menu
                    Menu {
                        Button { viewModel.fontSize = max(14, viewModel.fontSize - 2) } label: {
                            Label(L("Smaller Text", "文字を小さく"), systemImage: "textformat.size.smaller")
                        }
                        Button { viewModel.fontSize = min(28, viewModel.fontSize + 2) } label: {
                            Label(L("Larger Text", "文字を大きく"), systemImage: "textformat.size.larger")
                        }
                        Button { viewModel.fontSize = 17 } label: {
                            Label(L("Default Size", "標準の大きさ"), systemImage: "arrow.counterclockwise")
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
        .safeAreaInset(edge: .top) {
            if showAudio {
                ArticleAudioBar(speaker: speaker) { showAudio = false }
            }
        }
        .onDisappear { speaker.stop() }
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
                    Text(LearningLanguage.current.isJapanese ? topic.capitalized : Labels.topic(topic))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if let count = article.newWordCount, count > 0 {
                    Text(L("\(count) new words", "新出\(count)語"))
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    private func regionFlag(_ region: String) -> String {
        switch region.lowercased() {
        case "germany": return "🇩🇪"
        case "austria": return "🇦🇹"
        case "switzerland": return "🇨🇭"
        case "japan": return "🇯🇵"
        case "us", "usa", "united states": return "🇺🇸"
        case "uk", "united kingdom": return "🇬🇧"
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
                articleId: article.id,
                onWordTap: { word in
                    viewModel.selectedWord = word
                },
                // a word added from a lookup shows up in the article's word list at once
                onWordAdded: { Task { await viewModel.reloadQuietly(id: article.id) } }
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
            Label(L("English Translation", "日本語訳"), systemImage: "globe")
                .font(.headline)
        }
    }

    @ViewBuilder
    private func grammarSection(_ points: [GrammarPoint]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("Grammar Points", "文法のポイント"))
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
            Text(L("Vocabulary", "単語"))
                .font(.headline)

            let newWords = vocab.filter { $0.isNew?.value == true }
            let reviewWords = vocab.filter { $0.isReview?.value == true }

            if !newWords.isEmpty {
                Text(L("New Words", "新しい単語"))
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
                Text(L("Review Words", "復習の単語"))
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

}

// MARK: - Word Detail Sheet

struct WordDetailSheet: View {
    let word: VocabularyWord
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent(L("Romaji", "単語"), value: word.wordRomajiMacron)
                    if let kanji = word.wordKanji {
                        LabeledContent("Kanji", value: kanji)
                    }
                    if let kana = word.wordKana {
                        LabeledContent("Reading", value: kana)
                    }
                    LabeledContent(L("Meaning", "意味"), value: word.meaningEn)
                }

                Section {
                    if let pos = word.partOfSpeech, !pos.isEmpty {
                        LabeledContent(L("Part of Speech", "品詞"), value: Labels.partOfSpeech(pos))
                    }
                    if let level = word.jlptLevel {
                        LabeledContent(L("JLPT Level", "レベル"), value: level)
                    }
                    if let cat = word.category {
                        LabeledContent("Category", value: cat.capitalized)
                    }
                    LabeledContent(L("Status", "状態"), value: Labels.status(word.status))
                }

                if let context = word.contextSentence, !context.isEmpty {
                    Section(L("Context", "例文")) {
                        Text(context)
                            .font(.subheadline)
                    }
                }

                Section {
                    LabeledContent(L("Times Seen", "見た回数"), value: "\(word.timesSeen ?? 0)")
                    LabeledContent(L("Times Tested", "テストした回数"), value: "\(word.timesTested ?? 0)")
                    LabeledContent(L("Correct", "正解"), value: "\(word.timesTestedCorrect ?? 0)")
                }
            }
            .navigationTitle(word.wordRomajiMacron)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Done", "完了")) { dismiss() }
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
                        Section(L("New Words", "新しい単語")) {
                            ForEach(newWords) { word in
                                wordRow(word)
                            }
                        }
                    }
                    if !reviewWords.isEmpty {
                        Section(L("Review Words", "復習の単語")) {
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
            .navigationTitle(L("Word Lookup", "単語を調べる"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $viewModel.lookupQuery, prompt: L("Search words or meanings...", "単語や意味で検索…"))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Done", "完了")) { dismiss() }
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
                if let pos = word.partOfSpeech, !pos.isEmpty {
                    Text(Labels.partOfSpeech(pos))
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
