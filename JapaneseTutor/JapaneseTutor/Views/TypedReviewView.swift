import SwiftUI

// MARK: - Daily typed review (2026-11-10)
// Picking from 4 options overstated memory (kyoka and kiroku had app streaks
// but were missed in a real test). Here the learner sees the English and types
// the Japanese. Words come from GET /api/vocabulary/review (due / missed /
// still learning first). Missed words come back once at the end.

@Observable
class TypedReviewViewModel {
    /// noArticle: German noun typed without der / die / das — right, with a reminder
    enum Feedback: Equatable { case correct, typo, synonym(String), noArticle(String), wrong }

    var queue: [VocabularyWord] = []
    /// Word ID → other words of the learner's with the same meaning
    var alsoAccept: [Int: [String]] = [:]
    var total = 0
    var answer = ""
    var feedback: Feedback?
    var usedHint = false
    var isLoading = true
    var errorMessage: String?
    var firstTryCorrect = 0
    var missed: [VocabularyWord] = []
    private var answered: Set<Int> = []     // word IDs already scored (first attempt only)

    var current: VocabularyWord? { queue.first }
    var isFinished: Bool { !isLoading && total > 0 && queue.isEmpty }

    func load() async {
        isLoading = true
        do {
            let response = try await APIClient.shared.fetchReviewWords(limit: 10)
            queue = response.words
            total = response.words.count
            for (id, words) in response.alsoAccept ?? [:] {
                if let id = Int(id) { alsoAccept[id] = words }
            }
        } catch {
            errorMessage = L("Couldn't load your review words.", "復習の単語を読み込めませんでした。")
        }
        isLoading = false
    }

    func submit() async {
        guard let word = current, feedback == nil else { return }
        let result = Self.grade(answer, word: word, alsoAccept: alsoAccept[word.id] ?? [])
        feedback = result
        let correct = result != .wrong && !usedHint
        if answered.insert(word.id).inserted {
            if correct { firstTryCorrect += 1 } else { missed.append(word) }
            // A hint makes it practice, not proof of memory
            _ = try? await APIClient.shared.recordTestResult(id: word.id, correct: correct, mode: "typed")
        }
    }

    func next() {
        guard let word = queue.first else { return }
        queue.removeFirst()
        // Missed on the first try → ask once more at the end, right after seeing the answer
        if missed.contains(where: { $0.id == word.id }), retried.insert(word.id).inserted {
            queue.append(word)
        }
        answer = ""
        feedback = nil
        usedHint = false
    }
    private var retried: Set<Int> = []

    /// "kyōiku" — show "ky…" (first two letters, then dots per remaining letter)
    func hint(for word: VocabularyWord) -> String {
        // German / English: the word itself, without article and plural ("die Regierung, -en" → "Regierung")
        let w = LearningLanguage.current.isJapanese ? word.wordRomajiMacron : WordAnswer.parts(word.wordRomajiMacron).headword
        let shown = w.prefix(2)
        return shown + String(repeating: " ·", count: max(0, w.count - shown.count))
    }

    // MARK: Grading

    static func grade(_ typed: String, word: VocabularyWord, alsoAccept: [String] = []) -> Feedback {
        if !LearningLanguage.current.isJapanese { return gradeLatin(typed, word: word, alsoAccept: alsoAccept) }
        let given = normalize(typed)
        guard !given.isEmpty else { return .wrong }
        var targets = [word.wordRomajiMacron, word.wordRomaji].map(normalize)
        if let kana = word.wordKana { targets.append(kana) }
        // "teikyō suru" for a suru-noun is fine
        if targets.contains(given) || targets.contains(where: { given == $0 + "suru" }) { return .correct }
        // One wrong letter on a phone keyboard in a longer word
        if let main = targets.first, main.count >= 6, editDistance(given, main) == 1 { return .typo }
        // Another word with the same meaning ("plan": yotei for keikaku) is right too
        if let other = alsoAccept.first(where: { normalize($0) == given }) { return .synonym(other) }
        return .wrong
    }

    /// German / English. A German noun is asked with its article: "die Regierung".
    /// Without the article it counts, with a reminder; a wrong article is wrong.
    static func gradeLatin(_ typed: String, word: VocabularyWord, alsoAccept: [String] = []) -> Feedback {
        let given = WordAnswer.normalize(typed)
        guard !given.isEmpty else { return .wrong }
        let (article, headword) = WordAnswer.parts(word.wordRomajiMacron)
        let head = WordAnswer.normalize(headword)
        if let article {
            if given == "\(article) \(head)" { return .correct }
            if given == head { return .noArticle(article) }
            // another article in front of the right noun is a gender mistake, not a typo
            if ["der ", "die ", "das "].contains(where: { given.hasPrefix($0) }) {
                let noun = String(given.dropFirst(4))
                if given.hasPrefix(article + " "), head.count >= 6, editDistance(noun, head) == 1 { return .typo }
                if let other = alsoAccept.first(where: { WordAnswer.normalize(WordAnswer.parts($0).headword) == noun && given.hasPrefix((WordAnswer.parts($0).article ?? "") + " ") }) { return .synonym(other) }
                return .wrong
            }
        } else if given == head || given == "to \(head)" {
            return .correct
        }
        if head.count >= 6, editDistance(given, head) == 1 { return .typo }
        if let other = alsoAccept.first(where: { WordAnswer.normalize(WordAnswer.parts($0).headword) == given }) { return .synonym(other) }
        return .wrong
    }

    /// Lowercase, no macrons, no spaces / hyphens / apostrophes, long vowels
    /// written once (kyouiku = kyooiku = kyōiku). Applied to both sides.
    static func normalize(_ s: String) -> String {
        var t = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .lowercased()
            .filter { $0.isLetter }
        for (long, short) in [("ou", "o"), ("oo", "o"), ("uu", "u"), ("aa", "a"), ("ii", "i"), ("ee", "e")] {
            t = t.replacingOccurrences(of: long, with: short)
        }
        return t
    }

    static func editDistance(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        guard !a.isEmpty else { return b.count }
        guard !b.isEmpty else { return a.count }
        var row = Array(0...b.count)
        for i in 1...a.count {
            var diagonal = row[0]
            row[0] = i
            for j in 1...b.count {
                let above = row[j]
                row[j] = min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] == b[j - 1] ? 0 : 1))
                diagonal = above
            }
        }
        return row[b.count]
    }

    /// English prompt without give-aways: "paint (loanword from English 'paint')" → "paint"
    static func prompt(for word: VocabularyWord) -> String {
        word.meaningEn
            .replacingOccurrences(of: #"\s*\([^)]*(loanword|from English|katakana)[^)]*\)"#, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces)
    }
}

struct TypedReviewView: View {
    @State private var viewModel = TypedReviewViewModel()
    @FocusState private var fieldFocused: Bool
    @AppStorage("lastTypedReviewDate") private var lastReviewDate = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 20) {
            if viewModel.isLoading {
                ProgressView(L("Picking your words…", "単語を選んでいます…"))
            } else if let error = viewModel.errorMessage {
                Text(error).foregroundStyle(.red)
            } else if viewModel.total == 0 {
                ContentUnavailableView(
                    L("Nothing to review", "復習する単語はありません"),
                    systemImage: "checkmark.seal",
                    description: Text(L("You've reviewed all your words recently. Come back tomorrow.", "最近すべての単語を復習しました。また明日どうぞ。"))
                )
            } else if viewModel.isFinished {
                summary
            } else if let word = viewModel.current {
                question(word)
            }
        }
        .padding()
        .navigationTitle(L("Daily Review", "毎日の復習"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(L("Close", "閉じる")) { dismiss() }
            }
        }
        .task { await viewModel.load() }
        // The field is disabled while feedback shows; focus it again once the next word is up
        .onChange(of: viewModel.feedback == nil) { _, ready in
            if ready { fieldFocused = true }
        }
    }

    // MARK: Question

    @ViewBuilder
    private func question(_ word: VocabularyWord) -> some View {
        ProgressView(value: Double(viewModel.total - viewModel.queue.count), total: Double(max(viewModel.total, 1)))
            .tint(.accentColor)

        Spacer()

        Text(TypedReviewViewModel.prompt(for: word))
            .font(.title.weight(.bold))
            .multilineTextAlignment(.center)

        Text(typePrompt(word))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)

        if viewModel.usedHint {
            Text(viewModel.hint(for: word))
                .font(.title3.monospaced())
                .foregroundStyle(.orange)
        }

        TextField(L("romaji", WordAnswer.parts(word.wordRomajiMacron).article == nil ? "単語" : "der / die / das …"), text: $viewModel.answer)
            .font(.title2)
            .multilineTextAlignment(.center)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .focused($fieldFocused)
            .disabled(viewModel.feedback != nil)
            .padding()
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .onSubmit { Task { await viewModel.submit() } }
            .onAppear { fieldFocused = true }

        if let feedback = viewModel.feedback {
            feedbackView(feedback, word: word)
        } else {
            HStack(spacing: 12) {
                Button(L("Hint", "ヒント")) { viewModel.usedHint = true }
                    .disabled(viewModel.usedHint)
                    .buttonStyle(.bordered)
                Button {
                    Task { await viewModel.submit() }
                } label: {
                    Text(L("Check", "答える")).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.answer.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if LearningLanguage.current.isJapanese {
                Text("No macrons needed — kyouiku and kyōiku both count.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if LearningLanguage.current == .german {
                Text("ä ö ü ß は ae / oe / ue / ss でも正解です。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }

        Spacer()
    }

    @ViewBuilder
    private func feedbackView(_ feedback: TypedReviewViewModel.Feedback, word: VocabularyWord) -> some View {
        VStack(spacing: 8) {
            switch feedback {
            case .correct:
                Label(viewModel.usedHint ? L("Right — with a hint", "正解 (ヒントあり)") : L("Correct!", "正解です"), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            case .typo:
                Label(L("Correct — small typo", "正解 (小さな打ち間違い)"), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            case .synonym(let other):
                Label(L("\(other) is right too!", "\(other) も正解です"), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text(L("This time we were looking for:", "今回の答えは:"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case .noArticle(let article):
                Label(viewModel.usedHint ? "正解 (ヒントあり)" : "正解です", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("冠詞も覚えましょう: \(article)")
                    .font(.caption)
                    .foregroundStyle(.orange)
            case .wrong:
                Label(L("Not quite", "不正解です"), systemImage: "xmark.circle.fill")
                    .foregroundStyle(.red)
            }
            HStack(spacing: 8) {
                Text(word.wordRomajiMacron).font(.title2.weight(.semibold))
                if let kanji = word.wordKanji {
                    Text(kanji).foregroundStyle(.secondary)
                }
            }
            if feedback == .wrong {
                Text(L("It will come back once more at the end.", "最後にもう一度出ます。"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .font(.headline)

        Button {
            viewModel.next()
        } label: {
            Text(viewModel.queue.count <= 1 && feedback != .wrong ? L("See results", "結果を見る") : L("Next", "次へ"))
                .font(.headline)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
    }

    // MARK: Summary

    private var summary: some View {
        VStack(spacing: 16) {
            Image(systemName: viewModel.missed.isEmpty ? "star.fill" : "checkmark.seal.fill")
                .font(.system(size: 56))
                .foregroundStyle(viewModel.missed.isEmpty ? .yellow : .accentColor)
            Text(L("\(viewModel.firstTryCorrect) / \(viewModel.total) on the first try", "\(viewModel.total)語中 \(viewModel.firstTryCorrect)語が一回で正解"))
                .font(.title2.weight(.bold))
            if !viewModel.missed.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("Practise these again:", "もう一度練習しましょう:"))
                        .font(.headline)
                    ForEach(viewModel.missed) { w in
                        Text("\(w.wordRomajiMacron) — \(VocabQuizViewModel.firstSense(w.meaningEn))")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            Button(L("Done", "完了")) { dismiss() }
                .buttonStyle(.borderedProminent)
        }
        .onAppear { lastReviewDate = TypedReviewView.today }
    }

    private func typePrompt(_ word: VocabularyWord) -> String {
        let language = LearningLanguage.current
        if language.isJapanese { return "Type the Japanese word" }
        if language == .german, WordAnswer.parts(word.wordRomajiMacron).article != nil {
            return "ドイツ語の単語を、冠詞 (der / die / das) をつけて入力してください"
        }
        return "\(language.targetName)の単語を入力してください"
    }

    static var today: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}
