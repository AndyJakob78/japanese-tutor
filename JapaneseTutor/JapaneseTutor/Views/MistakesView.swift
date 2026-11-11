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
            errorMessage = "Couldn't load your mistakes. Please try again."
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
                ContentUnavailableView("Not loaded", systemImage: "wifi.exclamationmark", description: Text(error))
            } else if viewModel.mistakes.isEmpty {
                ContentUnavailableView(
                    "No mistakes yet",
                    systemImage: "checkmark.seal",
                    description: Text("Corrections from Build Sentences show up here, so you can see what to work on.")
                )
            } else {
                list
            }
        }
        .navigationTitle("My Mistakes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
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
                Text("Weak spots")
            } footer: {
                Text("Your new articles use these on purpose, and Build Sentences starts with the top one.")
            }

            Section("Recent corrections") {
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
