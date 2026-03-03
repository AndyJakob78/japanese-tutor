import SwiftUI
import StoreKit

// TODO: Replace with your actual product ID from App Store Connect
private let subscriptionProductID = "com.japaneseTutor.premium.monthly"

// TODO: Replace with your hosted URLs once you deploy the legal pages
private let privacyPolicyURL = URL(string: "https://YOUR_DOMAIN/privacy")!
private let termsOfUseURL   = URL(string: "https://YOUR_DOMAIN/terms")!

struct SubscriptionView: View {
    @State private var product: Product?
    @State private var isPurchasing = false
    @State private var isSubscribed = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {

                // MARK: Header
                VStack(spacing: 8) {
                    Image(systemName: "globe.asia.australia.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(.blue)
                    Text("Japanese Tutor Premium")
                        .font(.title2.bold())
                    Text("Unlimited AI-generated Japanese learning articles from real news")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 8)

                // MARK: Required subscription disclosure — Guideline 3.1.2(c)
                VStack(alignment: .leading, spacing: 10) {
                    Label("Subscription Details", systemImage: "info.circle")
                        .font(.headline)
                    Divider()
                    DisclosureRow(label: "Subscription Name", value: "Japanese Tutor Premium")
                    DisclosureRow(label: "Duration",          value: "1 Month")
                    DisclosureRow(label: "Price",             value: product?.displayPrice ?? "—")
                    DisclosureRow(label: "Renewal",           value: "Auto-renews monthly")
                }
                .padding()
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                // MARK: Features
                VStack(alignment: .leading, spacing: 12) {
                    Text("What's included")
                        .font(.headline)
                    FeatureRow(icon: "newspaper.fill",            text: "Unlimited article generation from real news")
                    FeatureRow(icon: "character.book.closed.fill", text: "Vocabulary tracking & review")
                    FeatureRow(icon: "checkmark.seal.fill",        text: "Personalized comprehension quizzes")
                    FeatureRow(icon: "chart.bar.fill",             text: "Progress statistics")
                    FeatureRow(icon: "dial.high.fill",             text: "JLPT N5–N1 difficulty settings")
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                // MARK: CTA / active state
                if isSubscribed {
                    Label("Active subscription", systemImage: "checkmark.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.green)
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(.green.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    VStack(spacing: 12) {
                        Button {
                            Task { await purchase() }
                        } label: {
                            Group {
                                if isPurchasing {
                                    ProgressView().tint(.white)
                                } else {
                                    let priceLabel = product.map { "for \($0.displayPrice) / month" } ?? ""
                                    Text("Subscribe \(priceLabel)")
                                        .fontWeight(.semibold)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                        }
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .disabled(isPurchasing || product == nil)

                        Button("Restore Purchases") {
                            Task { await restore() }
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                        if let error = errorMessage {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                        }
                    }
                }

                // MARK: Required legal links — Guideline 3.1.2(c)
                VStack(spacing: 8) {
                    Text("Subscription automatically renews unless cancelled at least 24 hours before the end of the current period. You can manage or cancel your subscription in your App Store account settings at any time.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    HStack(spacing: 16) {
                        Link("Privacy Policy", destination: privacyPolicyURL)
                        Text("•")
                            .foregroundStyle(.secondary)
                        Link("Terms of Use", destination: termsOfUseURL)
                    }
                    .font(.caption)
                }
                .padding(.bottom)
            }
            .padding(.horizontal)
        }
        .navigationTitle("Premium")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadProduct()
            await checkSubscriptionStatus()
        }
    }

    // MARK: - StoreKit

    private func loadProduct() async {
        do {
            let products = try await Product.products(for: [subscriptionProductID])
            product = products.first
        } catch {
            errorMessage = "Could not load subscription info. Check your connection and try again."
        }
    }

    private func purchase() async {
        guard let product else { return }
        isPurchasing = true
        errorMessage = nil
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await transaction.finish()
                isSubscribed = true
            case .userCancelled:
                break
            case .pending:
                errorMessage = "Purchase is pending approval (e.g. Ask to Buy)."
            @unknown default:
                break
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isPurchasing = false
    }

    private func restore() async {
        do {
            try await AppStore.sync()
            await checkSubscriptionStatus()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func checkSubscriptionStatus() async {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == subscriptionProductID,
               transaction.revocationDate == nil {
                isSubscribed = true
                return
            }
        }
        isSubscribed = false
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified: throw StoreError.failedVerification
        case .verified(let value): return value
        }
    }
}

// MARK: - Supporting views

private struct DisclosureRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.medium)
        }
        .font(.subheadline)
    }
}

private struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.subheadline)
    }
}

private enum StoreError: Error {
    case failedVerification
}

#Preview {
    NavigationStack {
        SubscriptionView()
    }
}
