import SwiftUI

import RevenueCat

struct PaywallView: View {
    /// Free articles still left; nil = unknown. Opened from the upsell banner
    /// with some left, the header must not say they're used up.
    var trialsRemaining: Int? = nil
    var onUpgradeSuccess: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedPlan: PlanType = .annual
    @State private var isPurchasing = false
    @State private var isRestoring  = false
    @State private var isLoadingOfferings = true
    @State private var errorMessage: String?

    private let rc = RevenueCatService.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    heroSection
                    featuresSection
                        .padding(.top, 32)
                    planPickerSection
                        .padding(.top, 32)
                        .padding(.horizontal, 24)
                    ctaSection
                        .padding(.top, 24)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 40)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Not Now", "あとで")) { dismiss() }
                        .foregroundStyle(.secondary)
                }
            }
            .task { await loadOfferings() }
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.red.opacity(0.12))
                    .frame(width: 100, height: 100)
                Text("文")
                    .font(.system(size: 52, weight: .bold))
                    .foregroundStyle(.red)
            }
            .padding(.top, 40)

            Text(L("Upgrade to Pro", "Proにアップグレード"))
                .font(.title.weight(.bold))

            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.bottom, 8)
    }

    private var subtitle: String {
        switch trialsRemaining {
        case .some(let left) where left > 0:
            return L("You have \(left) free \(left == 1 ? "article" : "articles") left.\nGo Pro for unlimited articles.", "無料の記事はあと\(left)本です。\nProなら無制限に作成できます。")
        case .some:
            return L("You've used your free articles.\nUnlock unlimited generation to keep learning.", "無料の記事を使い切りました。\nProで学習を続けましょう。")
        case .none:
            return L("Unlock unlimited articles to keep learning.", "Proで記事を無制限に作成できます。")
        }
    }

    // MARK: - Features

    private var featuresSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            featureRow(icon: "infinity",              color: .red,    title: L("Unlimited articles", "記事を無制限に"),      subtitle: L("Generate as many as you want, whenever you want", "好きなときに、好きなだけ記事を作成"))
            featureRow(icon: "sparkles",              color: .orange, title: L("Always fresh content", "毎日新しい内容"),     subtitle: L("New stories from real current events every day", "実際の最新ニュースから毎日新しい記事"))
            featureRow(icon: "character.book.closed", color: .blue,   title: L("All writing systems", "読み上げと文の練習"),     subtitle: L("Romaji, Hiragana, Kanji with furigana — switch anytime", "ネイティブの音声で聞き、自分で文を書いて添削"))
            featureRow(icon: "checkmark.seal",        color: .green,  title: L("Vocabulary tracking", "単語の記録と復習"),     subtitle: L("Spaced repetition keeps your words from slipping away", "間隔をあけた復習で単語を忘れない"))
        }
        .padding(.horizontal, 24)
    }

    private func featureRow(icon: String, color: Color, title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .foregroundStyle(color)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Plan Picker

    private var planPickerSection: some View {
        VStack(spacing: 12) {
            planCard(
                type: .annual,
                title: L("Annual", "年額"),
                price: annualPriceString,
                detail: annualDetailString,
                badge: L("Save 27%", "27%お得")
            )
            planCard(
                type: .monthly,
                title: L("Monthly", "月額"),
                price: monthlyPriceString,
                detail: nil,
                badge: nil
            )
        }
    }

    private func planCard(type: PlanType, title: String, price: String, detail: String?, badge: String?) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) { selectedPlan = type }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(title)
                            .font(.subheadline.weight(.semibold))
                        if let badge {
                            Text(badge)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.red)
                                .clipShape(Capsule())
                        }
                    }
                    if let detail {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Text(price)
                    .font(.subheadline.weight(.semibold))
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(selectedPlan == type ? Color.red : Color.gray.opacity(0.3), lineWidth: selectedPlan == type ? 2 : 1)
            )
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(selectedPlan == type ? Color.red.opacity(0.05) : Color.clear)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Price Strings

    private var monthlyPriceString: String {
        if let pkg = rc.monthlyPackage {
            return "\(pkg.localizedPriceString)/mo"
        }
        return "—"
    }

    private var annualPriceString: String {
        if let pkg = rc.annualPackage {
            return "\(pkg.localizedPriceString)/yr"
        }
        return "—"
    }

    private var annualDetailString: String? {
        guard let annual = rc.annualPackage else { return nil }
        let monthlyEquiv = annual.storeProduct.price / 12
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = annual.storeProduct.priceFormatter?.locale ?? .current
        return formatter.string(from: monthlyEquiv as NSDecimalNumber).map { "\($0)/mo" }
    }

    // MARK: - CTA

    private var ctaSection: some View {
        VStack(spacing: 12) {
            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            // ── Subscribe button ───────────────────────────────────────────
            Button {
                Task { await handlePurchase() }
            } label: {
                Group {
                    if isPurchasing || isLoadingOfferings {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text(subscribeButtonTitle)
                            .font(.headline)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .foregroundStyle(.white)
                .background(Color.red)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(isPurchasing || isRestoring || isLoadingOfferings)

            // ── Restore button ─────────────────────────────────────────────
            Button {
                Task { await handleRestore() }
            } label: {
                if isRestoring {
                    ProgressView()
                } else {
                    Text(L("Restore Purchases", "購入を復元"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .disabled(isPurchasing || isRestoring)

            Text(selectedPlan == .annual ? L("Cancel anytime. Billed annually.", "いつでも解約できます。年額でのお支払いです。") : L("Cancel anytime. Billed monthly.", "いつでも解約できます。月額でのお支払いです。"))
                .font(.caption2)
                .foregroundStyle(.tertiary)

            // Required by App Store: privacy policy + terms of use links
            HStack(spacing: 4) {
                Link(L("Privacy Policy", "プライバシーポリシー"), destination: URL(string: "https://andyjakob78.github.io/japanese-tutor/privacy-policy.html")!)
                Text("·")
                Link(L("Terms of Use", "利用規約"), destination: URL(string: "https://andyjakob78.github.io/japanese-tutor/terms-of-use.html")!)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }

    private var subscribeButtonTitle: String {
        switch selectedPlan {
        case .monthly:
            return L("Subscribe — \(monthlyPriceString)", "登録する — \(monthlyPriceString)")
        case .annual:
            return L("Subscribe — \(annualPriceString)", "登録する — \(annualPriceString)")
        }
    }

    // MARK: - Load Offerings

    private func loadOfferings() async {
        do {
            try await rc.loadOfferings()
        } catch {
            // Non-fatal — we fall back to hardcoded price strings
        }
        isLoadingOfferings = false
    }

    // MARK: - Purchase

    private func handlePurchase() async {
        guard let package = (selectedPlan == .annual ? rc.annualPackage : rc.monthlyPackage) else {
            errorMessage = L("Product not available. Please try again later.", "商品を利用できません。あとでもう一度お試しください。")
            return
        }

        isPurchasing = true
        errorMessage = nil

        do {
            let entitled = try await rc.purchase(package)
            if entitled {
                // RevenueCat confirmed — sync with our backend
                _ = try await APIClient.shared.upgradeDeviceToPro()
                onUpgradeSuccess()
            } else {
                errorMessage = L("Purchase could not be verified. Please try again.", "購入を確認できませんでした。もう一度お試しください。")
            }
        } catch let error as RevenueCat.ErrorCode where error == .purchaseCancelledError {
            // User tapped Cancel on the Apple payment sheet — no error needed
        } catch {
            errorMessage = error.localizedDescription
        }

        isPurchasing = false
    }

    // MARK: - Restore

    private func handleRestore() async {
        isRestoring = true
        errorMessage = nil

        do {
            let entitled = try await rc.restorePurchases()
            if entitled {
                _ = try await APIClient.shared.upgradeDeviceToPro()
                onUpgradeSuccess()
            } else {
                errorMessage = L("No active subscription found for this Apple ID.", "このApple IDに有効なサブスクリプションが見つかりません。")
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        isRestoring = false
    }
}

// MARK: - Plan Type

private enum PlanType {
    case monthly, annual
}

#Preview {
    PaywallView(onUpgradeSuccess: {})
}
