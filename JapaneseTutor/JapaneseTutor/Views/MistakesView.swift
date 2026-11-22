import SwiftUI

// MARK: - My Mistakes (2026-11-11)
// Sentence building used to show its corrections once and forget them. They
// are now saved on the server (GET /api/practice/mistakes): weak spots are the
// most frequent patterns of the last 60 days, and they come back as the focus
// of the next sentence session and inside new articles.

@Observable
class MistakesViewModel {
    var weakSpots: [WeakSpot] = []
    var mistakes: [SavedMistake] = []
    var isLoading = false
    var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await APIClient.shared.fetchMistakes()
            weakSpots = response.weakSpots
            mistakes = response.mistakes
        } catch {
            errorMessage = L("Couldn't load your mistakes. Please try again.", "読み込めませんでした。もう一度お試しください。")
        }
        isLoading = false
    }
}

struct MistakesView: View {
    @State private var viewModel = MistakesViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.mistakes.isEmpty {
                ProgressView()
            } else if let error = viewModel.errorMessage, viewModel.mistakes.isEmpty {
                ContentUnavailableView(L("Not loaded", "読み込めません"), systemImage: "wifi.exclamationmark", description: Text(error))
            } else if viewModel.mistakes.isEmpty {
                ContentUnavailableView(
                    L("No mistakes yet", "間違いはまだありません"),
                    systemImage: "checkmark.seal",
                    description: Text(L("Corrections from Build Sentences show up here, so you can see what to work on.", "「文を作る」で直された間違いがここに記録され、苦手なところがわかります。"))
                )
            } else {
                list
            }
        }
        .navigationTitle(L("My Mistakes", "間違いノート"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(L("Close", "閉じる")) { dismiss() }
            }
        }
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }

    private var list: some View {
        List {
            Section {
                ForEach(viewModel.weakSpots) { spot in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(spot.pattern)
                                .font(.headline)
                            Spacer()
                            Text("\(spot.count)×")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.orange)
                        }
                        Text(spot.typeLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(spot.example.why)
                            .font(.callout)
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text(L("Weak spots", "苦手なところ"))
            } footer: {
                Text(L("Your new articles use these on purpose, and Build Sentences starts with the top one.", "新しい記事ではこれらをわざと使います。「文を作る」は一番多い間違いから始まります。"))
            }

            Section(L("Recent corrections", "最近の間違い")) {
                ForEach(viewModel.mistakes) { m in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) {
                            Text(m.wrote)
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(m.correct)
                                .foregroundStyle(.green)
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Text(m.why)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if !m.corrected.isEmpty {
                            Text(m.corrected)
                                .font(.callout.italic())
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }
}
