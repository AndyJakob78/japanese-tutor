import SwiftUI

@Observable
class StatsViewModel {
    var stats: StatsResponse?
    var isLoading = false
    var errorMessage: String?

    func loadStats() async {
        isLoading = true
        do {
            stats = try await APIClient.shared.fetchStats()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct StatsView: View {
    @State private var viewModel = StatsViewModel()

    var body: some View {
        ScrollView {
            if viewModel.isLoading {
                ProgressView("Loading stats...")
                    .padding(.top, 100)
            } else if let stats = viewModel.stats {
                VStack(spacing: 20) {
                    // Streak
                    streakCard(stats.streak)

                    // Vocabulary overview
                    vocabularyOverview(stats.vocabulary)

                    // Status breakdown
                    statusBreakdown(stats.vocabulary.byStatus)

                    // JLPT level breakdown
                    if !stats.vocabulary.byLevel.isEmpty {
                        levelBreakdown(stats.vocabulary.byLevel)
                    }

                    // Articles stats
                    articleStats(stats.articles)

                    // Quiz average
                    if let avg = stats.quiz.averageScore {
                        quizAverage(avg)
                    }

                    // Due for review
                    if stats.vocabulary.dueForReview > 0 {
                        reviewReminder(stats.vocabulary.dueForReview)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Progress")
        .task {
            await viewModel.loadStats()
        }
        .refreshable {
            await viewModel.loadStats()
        }
    }

    // MARK: - Cards

    @ViewBuilder
    private func streakCard(_ streak: Int) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Current Streak")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("\(streak) day\(streak == 1 ? "" : "s")")
                    .font(.title.weight(.bold))
            }
            Spacer()
            Image(systemName: "flame.fill")
                .font(.system(size: 40))
                .foregroundStyle(streak > 0 ? .orange : .gray)
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func vocabularyOverview(_ vocab: VocabularyStats) -> some View {
        HStack(spacing: 16) {
            statBox(label: "Total Words", value: "\(vocab.total)", color: .accentColor)
            statBox(label: "Due for Review", value: "\(vocab.dueForReview)", color: .orange)
        }
    }

    @ViewBuilder
    private func statusBreakdown(_ counts: StatusCounts) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Vocabulary Status")
                .font(.headline)

            HStack(spacing: 12) {
                statusBar(label: "New", count: counts.new_, color: .gray)
                statusBar(label: "Learning", count: counts.learning, color: .orange)
                statusBar(label: "Known", count: counts.known, color: .blue)
                statusBar(label: "Mastered", count: counts.mastered, color: .green)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func levelBreakdown(_ levels: [LevelCount]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("JLPT Distribution")
                .font(.headline)

            ForEach(levels, id: \.jlptLevel) { level in
                HStack {
                    Text(level.jlptLevel)
                        .font(.subheadline.weight(.medium))
                        .frame(width: 30)

                    GeometryReader { geo in
                        let total = levels.reduce(0) { $0 + $1.count }
                        let width = total > 0 ? CGFloat(level.count) / CGFloat(total) * geo.size.width : 0

                        RoundedRectangle(cornerRadius: 4)
                            .fill(levelColor(level.jlptLevel))
                            .frame(width: max(width, 4), height: 20)
                    }
                    .frame(height: 20)

                    Text("\(level.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func articleStats(_ articles: ArticleStats) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Articles")
                .font(.headline)

            HStack(spacing: 16) {
                statBox(label: "Generated", value: "\(articles.total)", color: .accentColor)
                statBox(label: "Read", value: "\(articles.read)", color: .green)
                statBox(label: "Quizzed", value: "\(articles.quizzed)", color: .purple)
            }
        }
    }

    @ViewBuilder
    private func quizAverage(_ average: Int) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Average Quiz Score")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("\(average)%")
                    .font(.title.weight(.bold))
                    .foregroundStyle(average >= 70 ? .green : .orange)
            }
            Spacer()
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 30))
                .foregroundStyle(Color.accentColor)
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func reviewReminder(_ count: Int) -> some View {
        HStack {
            Image(systemName: "clock.badge.exclamationmark")
                .font(.title2)
                .foregroundStyle(.orange)
            VStack(alignment: .leading) {
                Text("\(count) words due for review")
                    .font(.subheadline.weight(.medium))
                Text("Review them to keep your vocabulary fresh")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Helpers

    @ViewBuilder
    private func statBox(label: String, value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private func statusBar(label: String, count: Int, color: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(count)")
                .font(.headline)
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "N5": return .green
        case "N4": return .blue
        case "N3": return .orange
        case "N2": return .red
        case "N1": return .purple
        default: return .gray
        }
    }
}

#Preview {
    NavigationStack {
        StatsView()
    }
}
