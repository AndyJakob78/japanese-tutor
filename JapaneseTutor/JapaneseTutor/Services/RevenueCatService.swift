import Foundation
import RevenueCat

/// Centralizes all RevenueCat SDK calls in one place.
/// Follows the same singleton + @Observable pattern as APIClient.
@Observable
class RevenueCatService {
    static let shared = RevenueCatService()

    /// RevenueCat public API key (safe to include in source code).
    private let apiKey = "appl_IuRyWLaWyuaGPxmNcHPteZhVVyu"

    /// Current offering loaded from RevenueCat (monthly + annual packages)
    var currentOffering: Offering?

    /// Whether the user has an active "pro" entitlement (client-side cache)
    var isProEntitled: Bool = false

    // MARK: - Setup

    /// Call once at app launch from JapaneseTutorApp.init().
    /// Sets the RevenueCat appUserID to our IDFV so the backend can
    /// verify subscriptions using the same identifier.
    func configure() {
        Purchases.logLevel = .debug
        Purchases.configure(
            with: .init(withAPIKey: apiKey)
                .with(appUserID: APIClient.shared.userId)
        )
    }

    // MARK: - Offerings

    /// Loads the current offering from RevenueCat. Call on PaywallView appear.
    /// Retries up to 3 times with increasing delays if no packages are found
    /// (common after App Store Connect metadata changes need time to propagate).
    func loadOfferings() async throws {
        let maxRetries = 3
        let retryDelays: [UInt64] = [0, 3_000_000_000, 6_000_000_000] // 0s, 3s, 6s

        for attempt in 0..<maxRetries {
            if attempt > 0 {
                print("[RevenueCat] Retry \(attempt)/\(maxRetries - 1) — waiting before next attempt…")
                try? await Task.sleep(nanoseconds: retryDelays[attempt])
            }

            let offerings = try await Purchases.shared.offerings()
            currentOffering = offerings.current

            // Debug: log what we got so we can diagnose pricing issues
            if let offering = currentOffering {
                print("[RevenueCat] Loaded offering: \(offering.identifier)")
                print("[RevenueCat] Available packages (\(offering.availablePackages.count)):")
                for pkg in offering.availablePackages {
                    let period = pkg.storeProduct.subscriptionPeriod
                    print("  - id: \(pkg.identifier), product: \(pkg.storeProduct.productIdentifier), price: \(pkg.localizedPriceString), period: \(period?.unit.rawValue ?? -1)/\(period?.value ?? 0)")
                }
                print("[RevenueCat] .monthly = \(offering.monthly?.identifier ?? "nil")")
                print("[RevenueCat] .annual = \(offering.annual?.identifier ?? "nil")")
                print("[RevenueCat] Resolved monthlyPackage = \(monthlyPackage?.identifier ?? "nil")")
                print("[RevenueCat] Resolved annualPackage = \(annualPackage?.identifier ?? "nil")")

                // If we got packages, we're done
                if monthlyPackage != nil || annualPackage != nil {
                    return
                }
                // Offering exists but no packages resolved — StoreKit can't fetch products yet
                print("[RevenueCat] WARNING: Offering loaded but no packages resolved — StoreKit may still be propagating")
            } else {
                print("[RevenueCat] WARNING: No current offering found")
                print("[RevenueCat] All offerings: \(offerings.all.keys.joined(separator: ", "))")
            }
        }

        print("[RevenueCat] Exhausted all retries — prices may not be available yet")
    }

    /// The monthly package — tries standard accessor first, then searches by subscription period.
    var monthlyPackage: Package? {
        if let pkg = currentOffering?.monthly { return pkg }
        // Fallback: find any package with a 1-month subscription period
        return currentOffering?.availablePackages.first { pkg in
            pkg.storeProduct.subscriptionPeriod?.unit == .month &&
            pkg.storeProduct.subscriptionPeriod?.value == 1
        }
    }

    /// The annual package — tries standard accessor first, then searches by subscription period.
    var annualPackage: Package? {
        if let pkg = currentOffering?.annual { return pkg }
        // Fallback: find any package with a 1-year subscription period
        return currentOffering?.availablePackages.first { pkg in
            pkg.storeProduct.subscriptionPeriod?.unit == .year &&
            pkg.storeProduct.subscriptionPeriod?.value == 1
        }
    }

    // MARK: - Purchases

    /// Purchase a specific package. Returns true if the "pro" entitlement is now active.
    func purchase(_ package: Package) async throws -> Bool {
        let result = try await Purchases.shared.purchase(package: package)
        let active = result.customerInfo.entitlements["pro"]?.isActive == true
        isProEntitled = active
        return active
    }

    /// Restore previous purchases. Returns true if the "pro" entitlement is now active.
    func restorePurchases() async throws -> Bool {
        let customerInfo = try await Purchases.shared.restorePurchases()
        let active = customerInfo.entitlements["pro"]?.isActive == true
        isProEntitled = active
        return active
    }

    /// Refresh the current entitlement status (e.g., when app returns to foreground).
    func refreshEntitlementStatus() async {
        do {
            let customerInfo = try await Purchases.shared.customerInfo()
            isProEntitled = customerInfo.entitlements["pro"]?.isActive == true
        } catch {
            // Silently fail — backend is the source of truth for the paywall gate
        }
    }
}
