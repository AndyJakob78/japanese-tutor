import SwiftUI

@Observable
class VocabularyViewModel {
    var words: [VocabularyWord] = []
    var isLoading = false
    var errorMessage: String?
    var selectedStatus: String? = nil
    var searchText = ""
    var selectedWord: VocabularyWord?
    var writingSystem: String = "romaji"

    let statuses = ["All", "new", "learning", "known", "mastered"]

    func loadVocabulary() async {
        isLoading = true
        do {
            let status = selectedStatus == "All" ? nil : selectedStatus
            let search = searchText.isEmpty ? nil : searchText
            let response = try await APIClient.shared.fetchVocabulary(
                status: status, search: search
            )
            words = response.vocabulary
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

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

            // Word list
            List(viewModel.words) { word in
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
            }
            .listStyle(.plain)
        }
        .searchable(text: $viewModel.searchText, prompt: "Search words")
        .onSubmit(of: .search) {
            Task { await viewModel.loadVocabulary() }
        }
        .navigationTitle("Vocabulary (\(viewModel.words.count))")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showVocabQuiz = true
                } label: {
                    Label("Quiz", systemImage: "questionmark.circle")
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

    func generateQuestions(from words: [VocabularyWord], count: Int = 10) {
        guard words.count >= 4 else { return }

        let quizWords = Array(words.shuffled().prefix(count))
        let allMeanings = words.map { $0.meaningEn }

        questions = quizWords.map { word in
            // Pick 3 random wrong answers
            let distractors = allMeanings.filter { $0 != word.meaningEn }.shuffled().prefix(3)
            var options = Array(distractors) + [word.meaningEn]
            options.shuffle()

            return Question(
                word: word,
                options: options,
                correctAnswer: word.meaningEn
            )
        }
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
            viewModel.generateQuestions(from: words)
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
