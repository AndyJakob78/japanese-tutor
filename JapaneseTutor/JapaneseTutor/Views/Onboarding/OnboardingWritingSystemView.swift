import SwiftUI

struct OnboardingWritingSystemView: View {
    @Bindable var vm: OnboardingViewModel

    private let systems: [(id: String, icon: String, title: String, subtitle: String, example: String)] = [
        (
            "romaji",
            "character.cursor.ibeam",
            "Romaji",
            "Latin alphabet. Best for complete beginners — no Japanese reading required.",
            "Watashi wa Nihongo wo benkyō shimasu."
        ),
        (
            "kana",
            "character.ja.hiragana",
            "Hiragana / Katakana",
            "Japanese syllabaries. Good if you already know hiragana and katakana.",
            "わたしはにほんごをべんきょうします。"
        ),
        (
            "kanji",
            "character.ja.katakana",
            "Kanji",
            "Full Japanese with kanji and furigana. For intermediate and above.",
            "私は日本語を勉強します。"
        ),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                onboardingHeroIcon(systemImage: "textformat")
                    .padding(.top, 40)

                VStack(spacing: 8) {
                    Text("How do you want to read?")
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)
                    Text("You can change this at any time in Settings.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                VStack(spacing: 10) {
                    ForEach(systems, id: \.id) { system in
                        WritingSystemCard(
                            system:     system,
                            isSelected: vm.selectedWritingSystem == system.id,
                            onTap:      { vm.selectedWritingSystem = system.id }
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

// MARK: - WritingSystemCard

private struct WritingSystemCard: View {
    let system: (id: String, icon: String, title: String, subtitle: String, example: String)
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: system.icon)
                        .font(.title3)
                        .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                    Text(system.title)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Color.accentColor)
                    }
                }
                Text(system.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(system.example)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
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
    OnboardingWritingSystemView(vm: OnboardingViewModel())
}
