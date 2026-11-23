import SwiftUI

/// Last setup step (1.7): where the learner heard about the app (one tap) and an
/// optional invite code from a friend. Both can be left empty.
struct OnboardingFinishView: View {
    @Bindable var vm: OnboardingViewModel

    static let sources: [(key: String, en: String, ja: String)] = [
        ("app_store", "App Store", "App Store"),
        ("instagram", "Instagram", "Instagram"),
        ("friend", "A friend", "友だち"),
        ("line", "LINE", "LINE"),
        ("x", "X", "X"),
        ("facebook", "Facebook", "Facebook"),
        ("tiktok", "TikTok", "TikTok"),
        ("other", "Other", "その他"),
    ]

    /// What the learner sees when an invite code does not work.
    static func message(for error: String) -> String {
        switch error {
        case "CODE_NOT_FOUND": return L("This invite code doesn't exist. Check it, or clear the field.", "この招待コードは見つかりません。確認するか、空欄にしてください。")
        case "OWN_CODE": return L("That's your own invite code.", "これはあなた自身の招待コードです。")
        case "ALREADY_REDEEMED": return L("This phone already used an invite code.", "このスマホではすでに招待コードを使いました。")
        case "NOT_NEW_DEVICE": return L("Invite codes work only on a new install.", "招待コードは新しくインストールしたときだけ使えます。")
        case "INVITER_CAP_REACHED": return L("Your friend's code has been used too often. Clear the field to continue.", "このコードは使用回数の上限に達しました。空欄にして進んでください。")
        default: return L("The invite code could not be checked. Try again.", "招待コードを確認できませんでした。もう一度お試しください。")
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                onboardingHeroSheep("ChapterHerd")
                    .padding(.top, 40)

                VStack(spacing: 8) {
                    Text(L("Almost done!", "もうすぐ完了！"))
                        .font(.title2.weight(.bold))
                    Text(L("Two small questions — both optional.", "2つの小さな質問です。どちらも任意です。"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text(L("Where did you hear about us?", "どこで知りましたか？"))
                        .font(.headline)
                    ChipGridView(
                        items: Self.sources.map(\.key),
                        label: { key in Self.sources.first { $0.key == key }.map { L($0.en, $0.ja) } ?? key },
                        isSelected: { vm.whereHeard == $0 },
                        isDisabled: { _ in false },
                        onTap: { vm.whereHeard = vm.whereHeard == $0 ? nil : $0 }
                    )
                }
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 10) {
                    Text(L("Invite code from a friend", "友だちの招待コード"))
                        .font(.headline)
                    TextField(L("e.g. KT7M2P", "例: KT7M2P"), text: $vm.inviteCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color.cardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .onChange(of: vm.inviteCode) { _, _ in vm.saveError = nil }
                    Text(L("You and your friend each get 1 extra free article.", "あなたと友だちに、無料の記事が1つずつ追加されます。"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 24)

                CelebrationView(isShowing: vm.showCelebration)

                Spacer(minLength: 0)
            }
            .padding(.bottom, 200)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

#Preview {
    OnboardingFinishView(vm: OnboardingViewModel())
}
