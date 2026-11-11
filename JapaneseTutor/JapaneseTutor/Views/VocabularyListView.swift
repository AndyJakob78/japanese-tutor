import SwiftUI

@Observable
class VocabularyViewModel {
    var words: [VocabularyWord] = []
    var isLoading = false
    /// True while a background page fetch is in flight (shows the footer spinner).
    var isLoadingMore = false
    var errorMessage: String?
    var selectedStatus: String? = nil
    var searchText = ""
    var selectedWord: VocabularyWord?
    var writingSystem: String = "romaji"

    // MARK: - Pagination state
    /// Words returned per page. 50 keeps responses fast while making pages feel large.
    private let pageSize = 50
    /// Offset for the next page request (= count of words already loaded).
    private(set) var currentOffset = 0
    /// Total words matching the current filter on the server (from `response.total`).
    private(set) var totalCount = 0
    /// True when there are more words on the server than we've loaded so far.
    var hasMore: Bool { words.count < totalCount }

    let statuses = ["All", "new", "learning", "known", "mastered"]

    // MARK: - Load (initial / refresh)

    /// Resets to page 0 and fetches fresh. Call on first appear, filter change, or pull-to-refresh.
    func loadVocabulary() async {
        isLoading = true
        errorMessage = nil
        currentOffset = 0
        do {
            let status = selectedStatus == "All" ? nil : selectedStatus
            let search = searchText.isEmpty ? nil : searchText
            let response = try await APIClient.shared.fetchVocabulary(
                status: status, search: search, limit: pageSize, offset: 0
            )
            words = response.vocabulary
            totalCount = response.total
            currentOffset = response.vocabulary.count
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    // MARK: - Pagination

    /// Fetches the next page and appends it to `words`. Safe to call multiple times — guards
    /// against concurrent fetches and stops automatically when all words are loaded.
    func loadNextPage() async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        do {
            let status = selectedStatus == "All" ? nil : selectedStatus
            let search = searchText.isEmpty ? nil : searchText
            let response = try await APIClient.shared.fetchVocabulary(
                status: status, search: search, limit: pageSize, offset: currentOffset
            )
            words.append(contentsOf: response.vocabulary)
            totalCount = response.total
            currentOffset += response.vocabulary.count
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingMore = false
    }

    /// Call from `.onAppear` on each list row. Only triggers a fetch when `word` is
    /// the last item in the list, so it fires exactly once at the bottom of each page.
    func loadMoreIfNeeded(currentWord word: VocabularyWord) async {
        guard let lastWord = words.last, lastWord.id == word.id else { return }
        await loadNextPage()
    }

    // MARK: - Helpers

    func loadWritingSystem() async {
        do {
            let config = try await APIClient.shared.fetchConfig()
            writingSystem = config.writingSystem
        } catch {
            // Default to romaji if config fetch fails
        }
    }

    func updateStatus(wordId: Int, newStatus: String) async {
        do {
            let updated = try await APIClient.shared.updateVocabularyStatus(id: wordId, status: newStatus)
            if let index = words.firstIndex(where: { $0.id == wordId }) {
                words[index] = updated
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct VocabularyListView: View {
    @State private var viewModel = VocabularyViewModel()
    @State private var showVocabQuiz = false
    @State private var showTypedReview = false
    @State private var showMistakes = false
    @AppStorage("lastTypedReviewDate") private var lastTypedReviewDate = ""

    var body: some View {
        VStack(spacing: 0) {
            // Status filter
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(viewModel.statuses, id: \.self) { status in
                        Button {
                            viewModel.selectedStatus = status == "All" ? nil : status
                            Task { await viewModel.loadVocabulary() }
                        } label: {
                            Text(status.capitalized)
                                .font(.caption)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(
                                    (viewModel.selectedStatus == status ||
                                     (status == "All" && viewModel.selectedStatus == nil))
                                    ? Color.accentColor : Color(.systemGray5)
                                )
                                .foregroundStyle(
                                    (viewModel.selectedStatus == status ||
                                     (status == "All" && viewModel.selectedStatus == nil))
                                    ? .white : .primary
                                )
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            Divider()

            // Word list — uses ForEach inside List so we can append a loading footer row
            List {
                // Daily typed review — recall, not recognition
                Button {
                    showTypedReview = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: lastTypedReviewDate == TypedReviewView.today ? "checkmark.circle.fill" : "keyboard")
                            .font(.title2)
                            .foregroundStyle(lastTypedReviewDate == TypedReviewView.today ? .green : .accentColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Daily Review")
                                .font(.headline)
                            Text(lastTypedReviewDate == TypedReviewView.today
                                 ? "Done today — you can go again"
                                 : "Type 10 words from memory · 3 min")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)

                // Mistake memory — corrections from Build Sentences
                Button {
                    showMistakes = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "scope")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("My Mistakes")
                                .font(.headline)
                            Text("Your weak spots from Build Sentences")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)

                ForEach(viewModel.words) { word in
                    Button {
                        viewModel.selectedWord = word
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 8) {
                                    Text(vocabPrimaryText(word))
                                        .font(.body.weight(.medium))
                                    if viewModel.writingSystem == "romaji", let kanji = word.wordKanji {
                                        Text(kanji)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                if viewModel.writingSystem != "romaji" {
                                    Text(word.wordRomajiMacron)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                Text(word.meaningEn)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            VStack(alignment: .trailing, spacing: 4) {
                                StatusBadge(status: word.status)

                                if let level = word.jlptLevel {
                                    Text(level)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        if word.status != "known" {
                            Button("Known") {
                                Task { await viewModel.updateStatus(wordId: word.id, newStatus: "known") }
                            }
                            .tint(.blue)
                        }
                        if word.status != "learning" {
                            Button("Review") {
                                Task { await viewModel.updateStatus(wordId: word.id, newStatus: "learning") }
                            }
                            .tint(.orange)
                        }
                    }
                    // Infinite scroll trigger: fires loadMoreIfNeeded only on the last row
                    .onAppear {
                        Task { await viewModel.loadMoreIfNeeded(currentWord: word) }
                    }
                }

                // Footer spinner — visible only while a next-page fetch is in flight
                if viewModel.isLoadingMore {
                    HStack {
                        Spacer()
                        ProgressView()
                            .padding(.vertical, 12)
                        Spacer()
                    }
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
        }
        .searchable(text: $viewModel.searchText, prompt: "Search words")
        .onSubmit(of: .search) {
            Task { await viewModel.loadVocabulary() }
        }
        // Show the server-side total so the number is correct even before all pages load
        .navigationTitle("Vocabulary (\(viewModel.totalCount > 0 ? viewModel.totalCount : viewModel.words.count))")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showVocabQuiz = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "brain.head.profile")
                        Text("Quiz")
                            .fontWeight(.semibold)
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                }
                .disabled(viewModel.words.count < 4)
            }
        }
        .task {
            await viewModel.loadWritingSystem()
            await viewModel.loadVocabulary()
        }
        .refreshable {
            await viewModel.loadVocabulary()
        }
        .sheet(item: $viewModel.selectedWord) { word in
            WordDetailSheet(word: word)
        }
        .fullScreenCover(isPresented: $showVocabQuiz) {
            NavigationStack {
                VocabularyQuizView(words: viewModel.words, writingSystem: viewModel.writingSystem)
            }
        }
        .fullScreenCover(isPresented: $showTypedReview) {
            NavigationStack {
                TypedReviewView()
            }
        }
        .sheet(isPresented: $showMistakes) {
            NavigationStack {
                MistakesView()
            }
        }
    }

    /// Returns the primary display text for a word based on current writing system
    private func vocabPrimaryText(_ word: VocabularyWord) -> String {
        switch viewModel.writingSystem {
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

// MARK: - Vocabulary Quiz (generated from vocabulary bank)

@Observable
class VocabQuizViewModel {
    struct Question: Identifiable {
        let id = UUID()
        let word: VocabularyWord
        let options: [String]
        let correctAnswer: String
        /// true = English meaning shown, pick the Japanese word (harder: recall direction)
        let isReverse: Bool
    }

    var questions: [Question] = []
    var currentIndex = 0
    var selectedOption: String?
    var showFeedback = false
    var isCorrect = false
    var correctCount = 0
    var results: [(word: VocabularyWord, correct: Bool)] = []

    var currentQuestion: Question? {
        guard currentIndex < questions.count else { return nil }
        return questions[currentIndex]
    }

    var progress: Double {
        guard !questions.isEmpty else { return 0 }
        return Double(currentIndex) / Double(questions.count)
    }

    var isFinished: Bool {
        currentIndex >= questions.count && !questions.isEmpty
    }

    // Harder quiz (2026-11-10, user found it too easy):
    // - weakest words first (never tested, short streak, not tested for longest)
    // - every second question goes English → Japanese
    // - wrong answers are the same kind of word (verb / noun / adjective),
    //   preferably the same topic and a similar length, and never a synonym
    // - meanings shown as their first sense only, so "habit, custom" doesn't
    //   stand out among one-word options
    func generateQuestions(from words: [VocabularyWord], count: Int = 10, writingSystem: String = "romaji") {
        guard words.count >= 4 else { return }

        let quizWords = Array(words.sorted { reviewNeed($0) > reviewNeed($1) }.prefix(count)).shuffled()

        questions = quizWords.enumerated().compactMap { index, word in
            // a loanword is too easy from English ("service" → sābisu), so ask those Japanese → English
            let isReverse = index % 2 == 1 && !Self.isLoanword(word)
            let answer = isReverse ? Self.japanese(word, writingSystem) : Self.firstSense(word.meaningEn)
            var seen: Set<String> = [answer.lowercased()]
            var distractors: [String] = []
            for other in rankedDistractors(for: word, in: words) where !(isReverse && Self.isLoanword(other)) {
                let text = isReverse ? Self.japanese(other, writingSystem) : Self.firstSense(other.meaningEn)
                if seen.insert(text.lowercased()).inserted { distractors.append(text) }
                if distractors.count == 3 { break }
            }
            guard distractors.count == 3 else { return nil }
            return Question(word: word, options: (distractors + [answer]).shuffled(), correctAnswer: answer, isReverse: isReverse)
        }
    }

    /// Higher = needs practice more. Untested words and broken streaks come first;
    /// random jitter so the same 10 words don't come back every time.
    private func reviewNeed(_ w: VocabularyWord) -> Double {
        let tested = w.timesTested ?? 0
        let streak = w.streakCorrect ?? 0
        var score = tested == 0 ? 3.0 : 2.0 / Double(1 + streak)
        if tested > 0, (w.timesTestedCorrect ?? 0) < tested { score += 1 }   // missed at least once
        return score + Double.random(in: 0..<1.2)
    }

    /// Candidates ordered from most to least tempting.
    private func rankedDistractors(for word: VocabularyWord, in words: [VocabularyWord]) -> [VocabularyWord] {
        let kind = Self.kind(of: word)
        let answerSenses = Self.senseWords(word.meaningEn)
        let answerLength = Self.firstSense(word.meaningEn).count
        return words
            .filter { $0.id != word.id && $0.wordRomajiMacron.lowercased() != word.wordRomajiMacron.lowercased() }
            // odd entries stand out: "reberu 4", "takushī-haisha apuri", "Labor Minister"
            .filter { Self.isPlainWord($0) || !Self.isPlainWord(word) }
            // a synonym would be a second right answer ("plan" → keikaku / yotei)
            .filter { Self.senseWords($0.meaningEn).isDisjoint(with: answerSenses) }
            .map { other -> (VocabularyWord, Double) in
                var score = Double.random(in: 0..<1)
                if Self.kind(of: other) == kind { score += 4 }
                if let c = word.category, c != "general", other.category == c { score += 1.5 }
                if abs(Self.firstSense(other.meaningEn).count - answerLength) <= 4 { score += 1 }
                return (other, score)
            }
            .sorted { $0.1 > $1.1 }
            .map { $0.0 }
    }

    static func japanese(_ w: VocabularyWord, _ writingSystem: String) -> String {
        switch writingSystem {
        case "kanji": return w.wordKanji ?? w.wordKana ?? w.wordRomajiMacron
        case "kana": return w.wordKana ?? w.wordRomajiMacron
        default: return w.wordRomajiMacron
        }
    }

    /// "habit, custom" → "habit"; "to look for; to search" → "to look for"
    static func firstSense(_ meaning: String) -> String {
        let first = meaning.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "/" }).first.map(String.init) ?? meaning
        let trimmed = first.replacingOccurrences(of: #"\s*\([^)]*\)"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? meaning : trimmed
    }

    /// Content words of every sense, for the synonym check ("to make a plan" → ["make", "plan"])
    private static let stopWords: Set<String> = ["to", "a", "an", "the", "of", "be", "and", "or", "in", "on", "for", "something", "someone", "thing", "one", "with", "up", "out"]
    static func senseWords(_ meaning: String) -> Set<String> {
        Set(meaning.lowercased()
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { $0.count > 2 && !stopWords.contains($0) })
    }

    /// Written only in katakana (sābisu, puroguramu)
    static func isLoanword(_ w: VocabularyWord) -> Bool {
        guard let kana = w.wordKana, !kana.isEmpty else { return false }
        return kana.unicodeScalars.allSatisfy { (0x30A0...0x30FF).contains($0.value) || $0 == "・" }
    }

    /// One word, no digits, no capitalised name
    static func isPlainWord(_ w: VocabularyWord) -> Bool {
        let ja = w.wordRomajiMacron
        let sense = firstSense(w.meaningEn)
        return !ja.contains(" ") && ja.rangeOfCharacter(from: .decimalDigits) == nil
            && sense.rangeOfCharacter(from: .decimalDigits) == nil
            && !(sense.first?.isUppercase ?? false)
            && !(w.partOfSpeech ?? "").lowercased().contains("proper")
    }

    enum Kind { case verb, adjective, other }
    static func kind(of w: VocabularyWord) -> Kind {
        let pos = (w.partOfSpeech ?? "").lowercased()
        if pos.contains("adj") { return .adjective }
        if pos == "verb" || (pos.contains("verb") && !pos.contains("adverb") && w.meaningEn.lowercased().hasPrefix("to ")) { return .verb }
        if w.meaningEn.lowercased().hasPrefix("to ") { return .verb }
        return .other
    }

    func selectAnswer(_ answer: String) {
        guard let question = currentQuestion, !showFeedback else { return }
        selectedOption = answer
        isCorrect = answer == question.correctAnswer
        if isCorrect { correctCount += 1 }
        showFeedback = true
        results.append((word: question.word, correct: isCorrect))
    }

    func nextQuestion() {
        showFeedback = false
        selectedOption = nil
        currentIndex += 1
    }

    func recordResults() async {
        for result in results {
            _ = try? await APIClient.shared.recordTestResult(id: result.word.id, correct: result.correct)
        }
    }
}

struct VocabularyQuizView: View {
    let words: [VocabularyWord]
    var writingSystem: String = "romaji"
    @State private var viewModel = VocabQuizViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack {
            if viewModel.isFinished {
                quizResultView
            } else if let question = viewModel.currentQuestion {
                questionView(question)
            } else {
                ProgressView("Preparing quiz...")
            }
        }
        .navigationTitle("Vocabulary Quiz")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
            }
        }
        .task {
            viewModel.generateQuestions(from: words, writingSystem: writingSystem)
        }
    }

    @ViewBuilder
    private func questionView(_ question: VocabQuizViewModel.Question) -> some View {
        VStack(spacing: 20) {
            ProgressView(value: viewModel.progress)
                .tint(.accentColor)
                .padding(.horizontal)

            Text("Question \(viewModel.currentIndex + 1) of \(viewModel.questions.count)")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            if question.isReverse {
                // English → Japanese: no kanji or reading shown, that would give it away
                Text(question.word.meaningEn)
                    .font(.title.weight(.bold))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Text("Which Japanese word means this?")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                // Show the word in the current writing system
                Text(quizWordText(question.word))
                    .font(.largeTitle.weight(.bold))

                if writingSystem != "romaji" {
                    Text(question.word.wordRomajiMacron)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                } else if let kanji = question.word.wordKanji {
                    Text(kanji)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                Text("What does this word mean?")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Answer options
            VStack(spacing: 10) {
                ForEach(question.options, id: \.self) { option in
                    Button {
                        viewModel.selectAnswer(option)
                    } label: {
                        HStack {
                            Text(option)
                                .font(.body)
                                .multilineTextAlignment(.leading)
                            Spacer()
                            if viewModel.showFeedback {
                                if option == question.correctAnswer {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.green)
                                } else if option == viewModel.selectedOption && !viewModel.isCorrect {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.red)
                                }
                            }
                        }
                        .padding()
                        .background(optionBackground(option, question: question))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(viewModel.showFeedback)
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)

            if viewModel.showFeedback {
                HStack {
                    Image(systemName: viewModel.isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(viewModel.isCorrect ? .green : .red)
                    Text(viewModel.isCorrect ? "Correct!" : "Incorrect")
                        .font(.headline)
                        .foregroundStyle(viewModel.isCorrect ? .green : .red)
                }

                Button {
                    viewModel.nextQuestion()
                    if viewModel.isFinished {
                        Task { await viewModel.recordResults() }
                    }
                } label: {
                    Text(viewModel.currentIndex + 1 >= viewModel.questions.count ? "See Results" : "Next")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal)
            }

            Spacer()
        }
        .padding(.vertical)
    }

    /// Returns the primary display text for a word based on writing system
    private func quizWordText(_ word: VocabularyWord) -> String {
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

    private func optionBackground(_ option: String, question: VocabQuizViewModel.Question) -> Color {
        guard viewModel.showFeedback else { return Color(.systemGray6) }
        if option == question.correctAnswer { return Color.green.opacity(0.2) }
        if option == viewModel.selectedOption && !viewModel.isCorrect { return Color.red.opacity(0.2) }
        return Color(.systemGray6)
    }

    @ViewBuilder
    private var quizResultView: some View {
        VStack(spacing: 24) {
            let percentage = viewModel.questions.isEmpty ? 0 : Int(Double(viewModel.correctCount) / Double(viewModel.questions.count) * 100)

            Image(systemName: percentage >= 70 ? "star.fill" : "arrow.counterclockwise")
                .font(.system(size: 60))
                .foregroundStyle(percentage >= 70 ? .yellow : .orange)

            Text("Quiz Complete!")
                .font(.title.weight(.bold))

            Text("\(viewModel.correctCount) / \(viewModel.questions.count) correct")
                .font(.title2)

            Text("\(percentage)%")
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(percentage >= 70 ? .green : .orange)

            // Show incorrect answers
            let incorrectResults = viewModel.results.filter { !$0.correct }
            if !incorrectResults.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Review these:")
                        .font(.headline)
                    ForEach(Array(incorrectResults.enumerated()), id: \.offset) { _, r in
                        HStack {
                            Image(systemName: "xmark.circle")
                                .foregroundStyle(.red)
                            VStack(alignment: .leading) {
                                Text(quizWordText(r.word))
                                    .font(.caption.weight(.medium))
                                if writingSystem != "romaji" {
                                    Text(r.word.wordRomajiMacron)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                Text(r.word.meaningEn)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)
            }

            Button("Done") { dismiss() }
                .font(.headline)
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)
        }
        .padding()
    }
}

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(status.capitalized)
            .font(.caption2)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(statusColor.opacity(0.15))
            .foregroundStyle(statusColor)
            .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch status {
        case "new": return .gray
        case "learning": return .orange
        case "known": return .blue
        case "mastered": return .green
        default: return .gray
        }
    }
}

#Preview {
    NavigationStack {
        VocabularyListView()
    }
}
