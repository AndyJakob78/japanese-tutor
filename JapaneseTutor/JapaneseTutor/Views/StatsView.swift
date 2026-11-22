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

/// The detailed numbers (word status, levels, articles). Opened from the progress screen.
struct StatsDetailsView: View {
    @State private var viewModel = StatsViewModel()

    var body: some View {
        ScrollView {
            if viewModel.isLoading {
                ProgressView(L("Loading stats...", "統計を読み込んでいます…"))
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
        .navigationTitle(L("All numbers", "くわしい数字"))
        .navigationBarTitleDisplayMode(.inline)
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
                Text(L("Current Streak", "連続学習"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(L("\(streak) day\(streak == 1 ? "" : "s")", "\(streak)日"))
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
            statBox(label: L("Total Words", "単語の合計"), value: "\(vocab.total)", color: .accentColor)
            statBox(label: L("Due for Review", "復習する単語"), value: "\(vocab.dueForReview)", color: .orange)
        }
        // Recall (typed answers, own sentences) and recognition (multiple choice) are different skills
        if let recall = vocab.recall, let choice = vocab.choice {
            HStack(spacing: 16) {
                statBox(label: L("Typed recall", "入力で正解"), value: recall.percent.map { "\($0)%" } ?? "–", color: .green)
                statBox(label: L("Multiple choice", "選択式で正解"), value: choice.percent.map { "\($0)%" } ?? "–", color: .blue)
            }
            Text(L("Only typed answers and your own sentences move a word to Known.", "入力した答えと自分で書いた文だけが、単語を「覚えた」に進めます。"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func statusBreakdown(_ counts: StatusCounts) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("Vocabulary Status", "単語の状態"))
                .font(.headline)

            HStack(spacing: 12) {
                statusBar(label: Labels.status("new"), count: counts.new_, color: .gray)
                statusBar(label: Labels.status("learning"), count: counts.learning, color: .orange)
                statusBar(label: Labels.status("known"), count: counts.known, color: .blue)
                statusBar(label: Labels.status("mastered"), count: counts.mastered, color: .green)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func levelBreakdown(_ levels: [LevelCount]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("JLPT Distribution", "単語のレベル"))
                .font(.headline)

            ForEach(levels, id: \.jlptLevel) { level in
                HStack {
                    Text(level.jlptLevel)
                        .font(.subheadline.weight(.medium))
                        .frame(width: LearningLanguage.current.isJapanese ? 30 : 56, alignment: .leading)

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
            Text(L("Articles", "記事"))
                .font(.headline)

            HStack(spacing: 16) {
                statBox(label: L("Generated", "作成"), value: "\(articles.total)", color: .accentColor)
                statBox(label: L("Read", "読んだ"), value: "\(articles.read)", color: .green)
                statBox(label: L("Quizzed", "クイズ済み"), value: "\(articles.quizzed)", color: .purple)
            }
        }
    }

    @ViewBuilder
    private func quizAverage(_ average: Int) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(L("Average Quiz Score", "クイズの平均点"))
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
                Text(L("\(count) words due for review", "\(count)語が復習の時期です"))
                    .font(.subheadline.weight(.medium))
                Text(L("Review them to keep your vocabulary fresh", "復習して単語を忘れないようにしましょう"))
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
        case "A1-A2": return .green
        case "B1": return .blue
        case "B2": return .orange
        case "C1+": return .red
        default: return .gray
        }
    }
}

#Preview {
    NavigationStack {
        StatsDetailsView()
    }
}
