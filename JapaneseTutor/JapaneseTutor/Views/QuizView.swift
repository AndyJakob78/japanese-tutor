import SwiftUI

@Observable
class QuizViewModel {
    var questions: [QuizQuestion] = []
    var currentIndex = 0
    var answers: [QuizAnswer] = []
    var selectedOption: String?
    var showFeedback = false
    var isCorrect = false
    var isLoading = false
    var isSubmitting = false
    var quizResult: QuizSubmitResponse?
    var errorMessage: String?
    var articleTitle: String = ""
    /// Question ID → its answer options in the order shown
    var options: [Int: [String]] = [:]

    var currentQuestion: QuizQuestion? {
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

    func loadQuiz(articleId: Int) async {
        isLoading = true
        do {
            let response = try await APIClient.shared.fetchQuiz(articleId: articleId)
            questions = response.questions
            // Shuffle once. `allOptions` shuffles on every call, so the answers
            // used to jump to new places the moment one was tapped.
            for q in response.questions { options[q.id] = q.allOptions }
            articleTitle = response.articleTitle
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func selectAnswer(_ answer: String) {
        guard let question = currentQuestion, !showFeedback else { return }
        selectedOption = answer
        isCorrect = answer.lowercased().trimmingCharacters(in: .whitespaces)
            == question.correctAnswer.lowercased().trimmingCharacters(in: .whitespaces)
        showFeedback = true
        answers.append(QuizAnswer(questionId: question.id, answer: answer))
    }

    func nextQuestion() {
        showFeedback = false
        selectedOption = nil
        currentIndex += 1
    }

    func submitResults(articleId: Int) async {
        isSubmitting = true
        do {
            quizResult = try await APIClient.shared.submitQuiz(articleId: articleId, answers: answers)
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}

struct QuizView: View {
    let articleId: Int
    @State private var viewModel = QuizViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack {
            if viewModel.isLoading {
                ProgressView(L("Loading quiz...", "クイズを読み込んでいます…"))
            } else if viewModel.isFinished {
                quizResultView
            } else if let question = viewModel.currentQuestion {
                questionView(question)
            } else if viewModel.questions.isEmpty {
                ContentUnavailableView(
                    L("No Quiz Available", "クイズがありません"),
                    systemImage: "questionmark.circle",
                    description: Text(L("This article doesn't have a quiz yet.", "この記事にはまだクイズがありません。"))
                )
            }
        }
        .navigationTitle(L("Quiz", "クイズ"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadQuiz(articleId: articleId)
        }
    }

    // MARK: - Question View

    @ViewBuilder
    private func questionView(_ question: QuizQuestion) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 20) {
                    // Progress bar
                    ProgressView(value: viewModel.progress)
                        .tint(.accentColor)
                        .padding(.horizontal)

                    Text(L("Question \(viewModel.currentIndex + 1) of \(viewModel.questions.count)", "\(viewModel.questions.count)問中 \(viewModel.currentIndex + 1)問目"))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    // Question type badge
                    Text(Labels.quizType(question.type))
                        .font(.caption2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.accentColor.opacity(0.15))
                        .clipShape(Capsule())

                    // Question text
                    Text(question.questionRomaji)
                        .font(.title3.weight(.medium))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    if let questionEn = question.questionEn {
                        Text(questionEn)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    // Answer options
                    if question.distractors.isEmpty {
                        // Free-form answer (for correction/construction types)
                        freeFormAnswer(question)
                    } else {
                        // Multiple choice
                        multipleChoiceOptions(question)
                    }

                    // Feedback
                    if viewModel.showFeedback {
                        feedbackView(question)
                    }
                }
                .padding(.vertical)
                .padding(.bottom, 16)
            }

            // Next button — pinned to bottom, outside scroll
            if viewModel.showFeedback {
                Button {
                    viewModel.nextQuestion()
                    if viewModel.isFinished {
                        Task {
                            await viewModel.submitResults(articleId: articleId)
                        }
                    }
                } label: {
                    Text(viewModel.currentIndex + 1 >= viewModel.questions.count ? L("See Results", "結果を見る") : L("Next Question", "次の問題"))
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal)
                .padding(.bottom, 16)
            }
        }
    }

    @ViewBuilder
    private func multipleChoiceOptions(_ question: QuizQuestion) -> some View {
        VStack(spacing: 10) {
            ForEach(viewModel.options[question.id] ?? question.allOptions, id: \.self) { option in
                Button {
                    viewModel.selectAnswer(option)
                } label: {
                    HStack(alignment: .top) {
                        Text(option)
                            .font(.body)
                            .multilineTextAlignment(.leading)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
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
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(optionBackground(option, question: question))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .disabled(viewModel.showFeedback)
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal)
    }

    private func optionBackground(_ option: String, question: QuizQuestion) -> Color {
        guard viewModel.showFeedback else {
            return Color(.systemGray6)
        }
        if option == question.correctAnswer {
            return Color.green.opacity(0.2)
        }
        if option == viewModel.selectedOption && !viewModel.isCorrect {
            return Color.red.opacity(0.2)
        }
        return Color(.systemGray6)
    }

    @ViewBuilder
    private func freeFormAnswer(_ question: QuizQuestion) -> some View {
        VStack(spacing: 12) {
            Text(L("Correct answer:", "正しい答え:"))
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(question.correctAnswer)
                .font(.body.weight(.medium))
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal)

            if !viewModel.showFeedback {
                HStack(spacing: 16) {
                    Button {
                        viewModel.selectAnswer("incorrect")
                    } label: {
                        Label(L("I got it wrong", "間違えた"), systemImage: "xmark")
                            .padding()
                            .background(Color.red.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    Button {
                        viewModel.selectAnswer(question.correctAnswer)
                    } label: {
                        Label(L("I got it right", "正解した"), systemImage: "checkmark")
                            .padding()
                            .background(Color.green.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func feedbackView(_ question: QuizQuestion) -> some View {
        VStack(spacing: 6) {
            HStack {
                Image(systemName: viewModel.isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(viewModel.isCorrect ? .green : .red)
                Text(viewModel.isCorrect ? L("Correct!", "正解です") : L("Incorrect", "不正解です"))
                    .font(.headline)
                    .foregroundStyle(viewModel.isCorrect ? .green : .red)
            }

            // German / English: the hint is the explanation of the answer — worth reading after a right answer too
            if !viewModel.isCorrect || !LearningLanguage.current.isJapanese, let hint = question.hint {
                Text(L("Hint: \(hint)", hint))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
    }

    // MARK: - Results View

    @ViewBuilder
    private var quizResultView: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 24) {
                    if viewModel.isSubmitting {
                        ProgressView(L("Submitting results...", "結果を保存しています…"))
                    } else if let result = viewModel.quizResult {
                        Image(systemName: result.score.percentage >= 70 ? "star.fill" : "arrow.counterclockwise")
                            .font(.system(size: 60))
                            .foregroundStyle(result.score.percentage >= 70 ? .yellow : .orange)

                        Text(L("Quiz Complete!", "クイズ完了！"))
                            .font(.title.weight(.bold))

                        Text(L("\(result.score.correct) / \(result.score.total) correct", "\(result.score.total)問中 \(result.score.correct)問正解"))
                            .font(.title2)

                        Text("\(result.score.percentage)%")
                            .font(.largeTitle.weight(.bold))
                            .foregroundStyle(result.score.percentage >= 70 ? .green : .orange)

                        // Show incorrect answers
                        let incorrectResults = result.results.filter { $0.correct == false }
                        if !incorrectResults.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(L("Review these:", "復習しましょう:"))
                                    .font(.headline)
                                ForEach(Array(incorrectResults.enumerated()), id: \.offset) { _, r in
                                    HStack {
                                        Image(systemName: "xmark.circle")
                                            .foregroundStyle(.red)
                                        VStack(alignment: .leading) {
                                            Text(L("Your answer: \(r.yourAnswer ?? "")", "あなたの答え: \(r.yourAnswer ?? "")"))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text(L("Correct: \(r.correctAnswer ?? "")", "正解: \(r.correctAnswer ?? "")"))
                                                .font(.caption.weight(.medium))
                                        }
                                    }
                                }
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .padding(.horizontal)
                        }
                    }
                }
                .padding()
                .padding(.bottom, 16)
            }

            // Done button — pinned to bottom, outside scroll
            if viewModel.quizResult != nil {
                Button(L("Done", "完了")) {
                    dismiss()
                }
                .font(.headline)
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)
                .padding(.bottom, 16)
            }
        }
    }
}

#Preview {
    NavigationStack {
        QuizView(articleId: 1)
    }
}
