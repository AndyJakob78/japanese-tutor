import SwiftUI

// MARK: - Article generation screen (2026-11-10)
// Generation takes 1–3 minutes. Before, the only sign was a spinner inside the
// "New Article" form. This screen says what's happening, how long it takes,
// and that the learner can leave the app or keep reading meanwhile.

/// Rough pipeline stages with the time (seconds) they usually start at.
/// The server doesn't report progress, so these are estimates by elapsed time.
private var generationSteps: [(start: TimeInterval, title: String, icon: String)] {
    [
        (0, L("Finding today's news", "今日のニュースを探しています"), "magnifyingglass"),
        (25, L("Writing the article at your level", "あなたのレベルで記事を書いています"), "pencil.line"),
        (70, L("Picking your new words", "新しい単語を選んでいます"), "character.book.closed"),
        (100, L("Making your quiz", "クイズを作っています"), "checklist"),
    ]
}

struct GeneratingView: View {
    let startedAt: Date
    var onMinimize: () -> Void

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
            let elapsed = context.date.timeIntervalSince(startedAt)
            VStack(spacing: 28) {
                Spacer()

                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.12))
                        .frame(width: 120, height: 120)
                    Image(systemName: "newspaper.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(Color.accentColor)
                        .symbolEffect(.pulse, options: .repeating)
                }

                VStack(spacing: 8) {
                    Text(L("Writing your article", "記事を作成しています"))
                        .font(.title2.weight(.bold))
                    Text(L("This usually takes 1–3 minutes.", "通常1〜3分かかります。"))
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(generationSteps.enumerated()), id: \.offset) { index, step in
                        stepRow(step, state: state(of: index, elapsed: elapsed))
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 14))

                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "iphone.and.arrow.forward")
                        .foregroundStyle(Color.accentColor)
                    Text(L("You can put the app in the background. Your new article will be at the top of the list when you come back.", "アプリを閉じても大丈夫です。戻ると、新しい記事が一覧の一番上にあります。"))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                Button {
                    onMinimize()
                } label: {
                    Text(L("Read other articles meanwhile", "その間にほかの記事を読む"))
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(.systemGray5))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
            .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private enum StepState { case done, active, waiting }

    private func state(of index: Int, elapsed: TimeInterval) -> StepState {
        let nextStart = index + 1 < generationSteps.count ? generationSteps[index + 1].start : .infinity
        if elapsed >= nextStart { return .done }
        if elapsed >= generationSteps[index].start { return .active }
        return .waiting
    }

    @ViewBuilder
    private func stepRow(_ step: (start: TimeInterval, title: String, icon: String), state: StepState) -> some View {
        HStack(spacing: 12) {
            Group {
                switch state {
                case .done:
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                case .active:
                    ProgressView()
                case .waiting:
                    Image(systemName: step.icon).foregroundStyle(.tertiary)
                }
            }
            .frame(width: 24)
            Text(step.title)
                .foregroundStyle(state == .waiting ? .secondary : .primary)
                .fontWeight(state == .active ? .semibold : .regular)
        }
    }
}

/// Row at the top of the article list while generation runs in the background.
struct GeneratingBanner: View {
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                ProgressView()
                Text(L("Writing your new article…", "新しい記事を作成しています…"))
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(L("Show", "表示"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.accentColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
