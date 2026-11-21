import SwiftUI

/// Sentence practice: the learner writes a German / English sentence with
/// words from the article and gets it checked. Explanations are in Japanese.
struct LangPracticeView: View {
    let article: LangArticle

    @Environment(\.dismiss) private var dismiss
    @State private var targets: [LangWord] = []
    @State private var sentence = ""
    @State private var check: LangSentenceCheck?
    @State private var isChecking = false
    @State private var errorMessage: String?
    @State private var firstTry = true
    @State private var focus: LangMistakesResponse.WeakSpot?
    @State private var wordIds: [String: String] = [:]   // dictionary form → id in the word list
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let focus {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("気をつけましょう: \(focus.pattern)", systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
                        Text("\(focus.example.wrote) → \(focus.example.correct)").font(.footnote)
                        Text(focus.example.why).font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                }

                Text("次の単語を使って、\(LearningLanguage.current.nameJa)で文を1つ書いてください。")
                    .font(.subheadline).foregroundStyle(.secondary)
                ForEach(targets) { word in
                    HStack(alignment: .firstTextBaseline) {
                        if let check, let use = check.words.first(where: { word.base.localizedCaseInsensitiveContains($0.word) || $0.word.localizedCaseInsensitiveContains(word.headwordOrBase) }) {
                            Image(systemName: use.usedCorrectly ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(use.usedCorrectly ? .green : .red)
                        }
                        Text(word.base).font(.headline)
                        Spacer()
                        Text(word.meaning).font(.subheadline).foregroundStyle(.secondary)
                    }
                }

                TextField("ここに文を書く", text: $sentence, axis: .vertical)
                    .lineLimit(2...4)
                    .textInputAutocapitalization(.sentences)
                    .autocorrectionDisabled()
                    .font(.title3)
                    .padding(14)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    .focused($focused)

                if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red) }

                Button { Task { await submit() } } label: {
                    HStack { if isChecking { ProgressView().tint(.white) }; Text(check == nil ? "チェックする" : "もう一度チェック") }
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isChecking || sentence.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if let check { result(check) }
            }
            .padding()
        }
        .navigationTitle("文を作る")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } }
            ToolbarItem(placement: .primaryAction) { Button("別の単語") { newRound() } }
        }
        .task {
            newRound()
            focus = (try? await APIClient.shared.fetchLangMistakes())?.weakSpots.first
            if let list = try? await APIClient.shared.fetchLangVocabulary().vocabulary {
                wordIds = Dictionary(list.compactMap { w in w.wordId.map { (w.base.lowercased(), $0) } }, uniquingKeysWith: { a, _ in a })
            }
        }
    }

    @ViewBuilder
    private func result(_ check: LangSentenceCheck) -> some View {
        let (label, color): (String, Color) = check.verdict == "correct" ? ("正しい文です", .green) : check.verdict == "almost" ? ("おしい！", .orange) : ("もう一度", .red)
        VStack(alignment: .leading, spacing: 10) {
            Text(label).font(.headline).foregroundStyle(color)
            if !check.corrected.isEmpty {
                Text(check.corrected).font(.title3.weight(.semibold))
                Text(check.translation).font(.callout).foregroundStyle(.secondary)
            }
            ForEach(check.fixes) { fix in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(fix.wrote).strikethrough().foregroundStyle(.red)
                        Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                        Text(fix.correct).foregroundStyle(.green).fontWeight(.semibold)
                    }
                    Text(fix.why).font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.top, 4)
            }
            if !check.tip.isEmpty {
                Label(check.tip, systemImage: "lightbulb").font(.footnote).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func newRound() {
        let pool = (article.vocabulary ?? []) + (article.reviewVocabulary ?? [])
        targets = Array(pool.shuffled().prefix(2))
        sentence = ""
        check = nil
        firstTry = true
        errorMessage = nil
    }

    private func submit() async {
        isChecking = true
        errorMessage = nil
        focused = false
        let level = article.level ?? UserDefaults.standard.string(forKey: LearningLanguage.current.levelKey) ?? "A1-A2"
        let request = LangSentenceRequest(
            words: targets.map { .init(word: $0.base, meaning: $0.meaning) },
            sentence: sentence, context: article.title, focus: focus?.pattern, firstTry: firstTry, level: level)
        do {
            let checked = try await APIClient.shared.checkLangSentence(request)
            check = checked
            // the first try moves the review schedule of the words, like in the Japanese version
            if firstTry {
                for target in targets {
                    guard let id = wordIds[target.base.lowercased()],
                          let use = checked.words.first(where: { target.base.localizedCaseInsensitiveContains($0.word) }) else { continue }
                    try? await APIClient.shared.recordLangTest(wordId: id, correct: use.usedCorrectly)
                }
            }
            firstTry = false
        } catch {
            errorMessage = "チェックできませんでした。もう一度お試しください。"
        }
        isChecking = false
    }
}

extension LangWord {
    var headwordOrBase: String { headword ?? base }
}

// MARK: - Mistake notes

struct LangMistakesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var data: LangMistakesResponse?
    @State private var failed = false

    var body: some View {
        List {
            if let data {
                if data.count == 0 {
                    ContentUnavailableView("間違いはまだありません", systemImage: "checkmark.seal", description: Text("記事の「文を作る」で書いた文の間違いが、ここに記録されます。"))
                }
                if !data.weakSpots.isEmpty {
                    Section("苦手なところ") {
                        ForEach(data.weakSpots) { spot in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(spot.typeLabel).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
                                    Spacer()
                                    Text("\(spot.count)回").font(.caption).foregroundStyle(.secondary)
                                }
                                Text(spot.pattern).font(.headline)
                                Text("\(spot.example.wrote) → \(spot.example.correct)").font(.subheadline)
                                Text(spot.example.why).font(.footnote).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                if !data.mistakes.isEmpty {
                    Section("最近の間違い") {
                        ForEach(data.mistakes) { m in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(m.sentence).font(.subheadline).foregroundStyle(.secondary).strikethrough()
                                Text(m.corrected).font(.subheadline.weight(.semibold))
                                Text(m.why).font(.footnote).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } else if failed {
                Text("読み込めませんでした。").foregroundStyle(.red).font(.footnote)
            }
        }
        .overlay { if data == nil && !failed { ProgressView() } }
        .navigationTitle("間違いノート")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
        .task {
            do { data = try await APIClient.shared.fetchLangMistakes() } catch { failed = true }
        }
    }
}
