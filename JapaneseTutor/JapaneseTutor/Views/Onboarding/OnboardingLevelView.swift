import SwiftUI

struct OnboardingLevelView: View {
    @Bindable var vm: OnboardingViewModel

    private let levels: [(id: String, label: String, subtitle: String)] = LearningLanguage.current.isJapanese ? [
        ("N5", "N5 — Beginner",           "First steps in Japanese — hiragana, basic vocabulary, simple sentences."),
        ("N4", "N4 — Elementary",          "Everyday conversations, ~300 kanji, simple grammar patterns."),
        ("N3", "N3 — Intermediate",        "News headlines, natural spoken Japanese, mixed kanji text."),
        ("N2", "N2 — Upper Intermediate",  "Newspapers, business Japanese, complex sentence structures."),
        ("N1", "N1 — Advanced",            "Native-level texts, nuanced expression, specialized vocabulary."),
    ] : [
        ("A1-A2", "A1–A2 — 入門",   "短い文と基本の単語。はじめての方、学び直したい方に。"),
        ("B1",    "B1 — 中級",      "日常の話題なら読める方に。少し長い文と、ニュースらしい表現。"),
        ("B2",    "B2 — 中上級",    "ニュースをほぼそのまま読みたい方に。自然な文体と幅広い単語。"),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                onboardingHeroSheep("SheepQuiz")
                    .padding(.top, 40)

                VStack(spacing: 8) {
                    Text(L("What is your JLPT level?", "\(LearningLanguage.current.targetName)のレベルを選んでください"))
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)
                    Text(L("Articles and vocabulary will be tuned to your level.", "記事と単語をあなたのレベルに合わせます。"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                VStack(spacing: 10) {
                    ForEach(levels, id: \.id) { level in
                        LevelCard(
                            levelId:   level.id,
                            label:     level.label,
                            subtitle:  level.subtitle,
                            isSelected: vm.selectedLevel == level.id,
                            onTap: { vm.selectedLevel = level.id }
                        )
                    }
                }
                .padding(.horizontal, 24)

                CelebrationView(isShowing: vm.showCelebration)

                Spacer(minLength: 0)
            }
            .padding(.bottom, 200)
        }
    }
}

// MARK: - LevelCard

private struct LevelCard: View {
    let levelId:   String
    let label:     String
    let subtitle:  String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                // Badge
                Text(levelId == "A1-A2" ? "A1\nA2" : levelId)   // two lines fit the square badge
                    .font(levelId == "A1-A2" ? .caption.weight(.bold) : .headline.weight(.bold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(isSelected ? .white : .primary)
                    .frame(width: 42, height: 42)
                    .background(isSelected ? Color.accentColor : Color(.systemGray5))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.accentColor)
                        .padding(.top, 2)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(
                        isSelected ? Color.accentColor : Color.gray.opacity(0.2),
                        lineWidth: isSelected ? 2 : 1
                    )
            )
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? Color.accentColor.opacity(0.06) : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.15), value: isSelected)
    }
}

#Preview {
    OnboardingLevelView(vm: OnboardingViewModel())
}
