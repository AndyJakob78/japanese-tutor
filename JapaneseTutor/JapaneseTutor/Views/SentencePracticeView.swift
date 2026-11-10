import SwiftUI

// MARK: - Sentence building (2026-11-10)
// Quizzes train recognition; this trains production. The learner gets two words
// from the article, writes a sentence, and Claude answers with a
// "You wrote ❌ | Correct ✅" table. Three rounds, then a short summary.

@Observable
class SentencePracticeViewModel {
    struct Round: Identifiable {
        let id = UUID()
        let words: [VocabularyWord]
        var result: SentenceCheckResponse?
    }

    static let roundCount = 3

    var rounds: [Round] = []
    var currentIndex = 0
    var sentence = ""
    var isChecking = false
    var errorMessage: String?

    var currentRound: Round? {
        currentIndex < rounds.count ? rounds[currentIndex] : nil
    }

    var isFinished: Bool { !rounds.isEmpty && currentIndex >= rounds.count }

    /// Pairs of one verb and one other word where possible, so every sentence
    /// needs a particle choice around a verb.
    func setUp(vocabulary: [VocabularyWord]) {
        guard rounds.isEmpty else { return }
        let usable = vocabulary.filter { !$0.wordRomajiMacron.contains(" ") }
        var verbs = usable.filter { VocabQuizViewModel.kind(of: $0) == .verb }.shuffled()
        var others = usable.filter { VocabQuizViewModel.kind(of: $0) != .verb }.shuffled()
        for _ in 0..<Self.roundCount {
            var pair: [VocabularyWord] = []
            if let v = verbs.popLast() { pair.append(v) }
            if let o = others.popLast() { pair.append(o) }
            while pair.count < 2, let extra = verbs.popLast() ?? others.popLast() { pair.append(extra) }
            if pair.isEmpty { break }
            rounds.append(Round(words: pair))
        }
    }

    func check(context: String?) async {
        guard let round = currentRound else { return }
        let text = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let firstTry = round.result == nil
        isChecking = true
        errorMessage = nil
        do {
            let result = try await APIClient.shared.checkSentence(words: round.words, sentence: text, context: context)
            rounds[currentIndex].result = result
            // Using a word in your own sentence is the strongest sign you know it —
            // count the first attempt of each round towards the word's streak.
            if firstTry {
                for use in result.words {
                    if let word = round.words.first(where: { $0.wordRomajiMacron.lowercased() == use.word.lowercased() }) {
                        _ = try? await APIClient.shared.recordTestResult(id: word.id, correct: use.usedCorrectly)
                    }
                }
            }
        } catch {
            errorMessage = "Couldn't check the sentence. Please try again."
        }
        isChecking = false
    }

    func next() {
        currentIndex += 1
        sentence = ""
    }
}

struct SentencePracticeView: View {
    let article: Article
    @State private var viewModel = SentencePracticeViewModel()
    @FocusState private var isEditing: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if viewModel.isFinished {
                    summary
                } else if let round = viewModel.currentRound {
                    roundView(round)
                } else {
                    ContentUnavailableView(
                        "Not enough words",
                        systemImage: "text.badge.xmark",
                        description: Text("This article has no vocabulary to practise with.")
                    )
                }
            }
            .padding()
        }
        .navigationTitle("Build Sentences")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { viewModel.setUp(vocabulary: article.vocabulary ?? []) }
    }

    // MARK: Round

    @ViewBuilder
    private func roundView(_ round: SentencePracticeViewModel.Round) -> some View {
        Text("Sentence \(viewModel.currentIndex + 1) of \(viewModel.rounds.count)")
            .font(.caption)
            .foregroundStyle(.secondary)

        Text("Write one sentence that uses \(round.words.count == 1 ? "this word" : "both words"):")
            .font(.headline)

        ForEach(round.words) { word in
            HStack(alignment: .firstTextBaseline) {
                Text(word.wordRomajiMacron)
                    .font(.title3.weight(.semibold))
                Text(VocabQuizViewModel.firstSense(word.meaningEn))
                    .foregroundStyle(.secondary)
            }
        }

        TextField("e.g. Yachin ga agatta node, …", text: $viewModel.sentence, axis: .vertical)
            .lineLimit(3...6)
            .textInputAutocapitalization(.sentences)
            .autocorrectionDisabled()
            .focused($isEditing)
            .padding(12)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 10))

        Text("Romaji is fine — no need for macrons (ā, ō).")
            .font(.caption)
            .foregroundStyle(.secondary)

        Button {
            isEditing = false
            Task { await viewModel.check(context: stripMarkers(article.titleRomaji)) }
        } label: {
            HStack {
                if viewModel.isChecking { ProgressView().tint(.white) }
                Text(viewModel.isChecking ? "Checking…" : (round.result == nil ? "Check" : "Check again"))
                    .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.accentColor)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(viewModel.isChecking || viewModel.sentence.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        if let error = viewModel.errorMessage {
            Text(error)
                .font(.caption)
                .foregroundStyle(.red)
        }

        if let result = round.result {
            feedback(result)

            Button {
                viewModel.next()
            } label: {
                Text(viewModel.currentIndex + 1 >= viewModel.rounds.count ? "Finish" : "Next sentence")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.systemGray5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Feedback

    @ViewBuilder
    private func feedback(_ result: SentenceCheckResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: verdictIcon(result.verdict))
                Text(verdictTitle(result.verdict))
                    .font(.headline)
            }
            .foregroundStyle(verdictColor(result.verdict))

            // "You wrote ❌ | Correct ✅" — the format that works best for the learner
            if !result.fixes.isEmpty {
                VStack(spacing: 0) {
                    HStack {
                        Text("You wrote ❌").frame(maxWidth: .infinity, alignment: .leading)
                        Text("Correct ✅").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 6)

                    ForEach(result.fixes, id: \.self) { fix in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .top) {
                                Text(fix.wrote)
                                    .foregroundStyle(.red)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text(fix.correct)
                                    .foregroundStyle(.green)
                                    .fontWeight(.semibold)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            Text(fix.why)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 8)
                        Divider()
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(result.corrected)
                    .font(.body.weight(.medium))
                Text(result.english)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if !result.tip.isEmpty {
                Text(result.tip)
                    .font(.callout)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(verdictColor(result.verdict).opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func verdictTitle(_ v: String) -> String {
        switch v {
        case "correct": return "Perfect!"
        case "almost": return "Almost — small fix"
        default: return "Let's fix this"
        }
    }

    private func verdictIcon(_ v: String) -> String {
        switch v {
        case "correct": return "checkmark.circle.fill"
        case "almost": return "exclamationmark.circle.fill"
        default: return "xmark.circle.fill"
        }
    }

    private func verdictColor(_ v: String) -> Color {
        switch v {
        case "correct": return .green
        case "almost": return .orange
        default: return .red
        }
    }

    // MARK: Summary

    @ViewBuilder
    private var summary: some View {
        let perfect = viewModel.rounds.filter { $0.result?.verdict == "correct" }.count
        VStack(spacing: 16) {
            Image(systemName: perfect == viewModel.rounds.count ? "star.fill" : "text.badge.checkmark")
                .font(.system(size: 56))
                .foregroundStyle(perfect == viewModel.rounds.count ? .yellow : .accentColor)
            Text("\(perfect) of \(viewModel.rounds.count) perfect")
                .font(.title2.weight(.bold))
            Text("Every sentence you write yourself makes these words stick better than reading them.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Done") { dismiss() }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}
