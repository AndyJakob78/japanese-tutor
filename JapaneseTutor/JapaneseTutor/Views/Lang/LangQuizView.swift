import SwiftUI

/// One question at a time. The answer is checked on the device (the article
/// already holds the right answers); the score is saved at the end.
struct LangQuizView: View {
    let articleId: Int
    let questions: [LangQuizQuestion]
    var onFinished: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var chosen: Int?
    @State private var answers: [Int] = []
    @State private var finished = false
    @State private var saveFailed = false

    private var correctCount: Int {
        zip(answers, questions).filter { $0 == $1.answerIndex }.count
    }

    var body: some View {
        ScrollView {
            if finished {
                result
            } else {
                question(questions[index])
            }
        }
        .navigationTitle(finished ? "結果" : "クイズ \(index + 1)/\(questions.count)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } }
        }
    }

    @ViewBuilder
    private func question(_ q: LangQuizQuestion) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(q.instruction).font(.subheadline).foregroundStyle(.secondary)
            Text(q.question).font(.title3.weight(.semibold))

            ForEach(Array(q.options.enumerated()), id: \.offset) { i, option in
                Button {
                    if chosen == nil { chosen = i }
                } label: {
                    HStack {
                        Text(option).multilineTextAlignment(.leading)
                        Spacer()
                        if let chosen {
                            if i == q.answerIndex { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                            else if i == chosen { Image(systemName: "xmark.circle.fill").foregroundStyle(.red) }
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(background(for: i, answer: q.answerIndex), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(chosen != nil)
            }

            if let chosen {
                VStack(alignment: .leading, spacing: 6) {
                    Text(chosen == q.answerIndex ? "正解です" : "残念、不正解です")
                        .font(.headline)
                        .foregroundStyle(chosen == q.answerIndex ? .green : .red)
                    Text(q.explanation).font(.callout)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

                Button { next(chosen) } label: {
                    Text(index + 1 < questions.count ? "次へ" : "結果を見る")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }

    private func background(for option: Int, answer: Int) -> Color {
        guard let chosen else { return Color(.secondarySystemBackground) }
        if option == answer { return Color.green.opacity(0.15) }
        if option == chosen { return Color.red.opacity(0.15) }
        return Color(.secondarySystemBackground)
    }

    private var result: some View {
        VStack(spacing: 16) {
            Image(systemName: correctCount == questions.count ? "star.circle.fill" : "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(Color.accentColor)
                .padding(.top, 40)
            Text("\(questions.count)問中 \(correctCount)問正解").font(.title2.bold())
            if saveFailed {
                Text("結果を保存できませんでした。").font(.footnote).foregroundStyle(.red)
            }
            Button("記事に戻る") { dismiss() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .padding()
    }

    private func next(_ answer: Int) {
        answers.append(answer)
        chosen = nil
        if index + 1 < questions.count {
            index += 1
        } else {
            finished = true
            Task {
                do { _ = try await APIClient.shared.submitLangQuiz(articleId: articleId, answers: answers) }
                catch { saveFailed = true }
                await onFinished()
            }
        }
    }
}
