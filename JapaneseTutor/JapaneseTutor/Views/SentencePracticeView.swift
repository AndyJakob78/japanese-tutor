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
    /// The learner's most frequent slip from earlier sessions (mistake memory)
    var focus: WeakSpot?
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
        // Japanese: one-word entries only. German / English dictionary forms have spaces ("die Regierung, -en").
        let usable = vocabulary.filter { !LearningLanguage.current.isJapanese || !$0.wordRomajiMacron.contains(" ") }
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

    func loadFocus() async {
        guard focus == nil else { return }
        focus = try? await APIClient.shared.fetchMistakes().weakSpots.first
    }

    func check(context: String?) async {
        guard let round = currentRound else { return }
        let text = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let firstTry = round.result == nil
        isChecking = true
        errorMessage = nil
        do {
            let result = try await APIClient.shared.checkSentence(
                words: round.words, sentence: text, context: context,
                focus: focus?.focusText, firstTry: firstTry
            )
            rounds[currentIndex].result = result
            // Using a word in your own sentence is the strongest sign you know it —
            // count the first attempt of each round towards the word's streak.
            if firstTry {
                for use in result.words {
                    if let word = round.words.first(where: { Self.sameWord($0, use.word) }) {
                        _ = try? await APIClient.shared.recordTestResult(id: word.id, correct: use.usedCorrectly, mode: "sentence")
                    }
                }
            }
        } catch {
            errorMessage = L("Couldn't check the sentence. Please try again.", "チェックできませんでした。もう一度お試しください。")
        }
        isChecking = false
    }

    func next() {
        currentIndex += 1
        sentence = ""
    }

    /// Is `answered` (the word as the check names it) this vocabulary word?
    static func sameWord(_ word: VocabularyWord, _ answered: String) -> Bool {
        let a = answered.lowercased()
        if word.wordRomajiMacron.lowercased() == a { return true }
        guard !LearningLanguage.current.isJapanese else { return false }
        // "die Regierung, -en" is named as written, or as "Regierung"
        let head = WordAnswer.parts(word.wordRomajiMacron).headword.lowercased()
        return a == head || a.contains(head) || WordAnswer.parts(answered).headword.lowercased() == head
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
                        L("Not enough words", "単語が足りません"),
                        systemImage: "text.badge.xmark",
                        description: Text(L("This article has no vocabulary to practise with.", "この記事には練習できる単語がありません。"))
                    )
                }
            }
            .padding()
        }
        .navigationTitle(L("Build Sentences", "文を作る"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { viewModel.setUp(vocabulary: article.vocabulary ?? []) }
        .task { await viewModel.loadFocus() }
    }

    // MARK: Round

    @ViewBuilder
    private func roundView(_ round: SentencePracticeViewModel.Round) -> some View {
        Text(L("Sentence \(viewModel.currentIndex + 1) of \(viewModel.rounds.count)", "\(viewModel.rounds.count)文中 \(viewModel.currentIndex + 1)文目"))
            .font(.caption)
            .foregroundStyle(.secondary)

        Text(L("Write one sentence that uses \(round.words.count == 1 ? "this word" : "both words"):", "\(round.words.count == 1 ? "この単語" : "2つの単語")を使って、\(LearningLanguage.current.targetName)で文を1つ書いてください:"))
            .font(.headline)

        if let focus = viewModel.focus {
            focusCard(focus)
        }

        ForEach(round.words) { word in
            HStack(alignment: .firstTextBaseline) {
                Text(word.wordRomajiMacron)
                    .font(.title3.weight(.semibold))
                Text(VocabQuizViewModel.firstSense(word.meaningEn))
                    .foregroundStyle(.secondary)
            }
        }

        TextField(L("e.g. Yachin ga agatta node, …", "ここに文を書く"), text: $viewModel.sentence, axis: .vertical)
            .lineLimit(3...6)
            .textInputAutocapitalization(.sentences)
            .autocorrectionDisabled()
            .focused($isEditing)
            .padding(12)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 10))

        if LearningLanguage.current.isJapanese {
            Text("Romaji is fine — no need for macrons (ā, ō).")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if LearningLanguage.current == .german {
            Text("ä ö ü ß は ae / oe / ue / ss と書いてもかまいません。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }

        Button {
            isEditing = false
            Task { await viewModel.check(context: stripMarkers(article.titleRomaji)) }
        } label: {
            HStack {
                if viewModel.isChecking { ProgressView().tint(.white) }
                Text(viewModel.isChecking ? L("Checking…", "チェック中…") : (round.result == nil ? L("Check", "チェックする") : L("Check again", "もう一度チェック")))
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
                Text(viewModel.currentIndex + 1 >= viewModel.rounds.count ? L("Finish", "終わる") : L("Next sentence", "次の文"))
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.systemGray5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Focus (mistake memory)

    private func focusCard(_ spot: WeakSpot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(L("Watch out: \(spot.pattern)", "気をつけましょう: \(spot.pattern)"), systemImage: "scope")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
            Text(L("Before: \(spot.example.wrote) → \(spot.example.correct). \(spot.example.why)", "前回: \(spot.example.wrote) → \(spot.example.correct)　\(spot.example.why)"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
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
                        Text(L("You wrote ❌", "あなたの文 ❌")).frame(maxWidth: .infinity, alignment: .leading)
                        Text(L("Correct ✅", "正しい形 ✅")).frame(maxWidth: .infinity, alignment: .leading)
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
        case "correct": return L("Perfect!", "正しい文です！")
        case "almost": return L("Almost — small fix", "おしい！少しだけ直しましょう")
        default: return L("Let's fix this", "直してみましょう")
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
            Text(L("\(perfect) of \(viewModel.rounds.count) perfect", "\(viewModel.rounds.count)文中 \(perfect)文が完璧"))
                .font(.title2.weight(.bold))
            Text(L("Every sentence you write yourself makes these words stick better than reading them.", "自分で文を書くと、読むだけよりも単語がしっかり身につきます。"))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if viewModel.rounds.contains(where: { !($0.result?.fixes.isEmpty ?? true) }) {
                Text(L("Your corrections are saved in My Mistakes. Your next articles will practise them, and the next session starts with your most common one.", "直されたところは「間違いノート」に保存されました。次の記事で練習でき、次回は一番多い間違いから始まります。"))
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            Button(L("Done", "完了")) { dismiss() }
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
