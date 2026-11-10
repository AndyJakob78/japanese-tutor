import SwiftUI
import StoreKit
import RevenueCat

@Observable
class ArticleFeedViewModel {
    var articles: [Article] = []
    var isLoading = false
    var isGenerating = false
    /// When generation started — drives the progress steps on the generating screen
    var generationStartedAt: Date?
    /// User tapped "Read other articles meanwhile": show a small banner instead of the full screen
    var generatingMinimized = false
    var errorMessage: String?
    var showPaywall = false
    var deviceStatus: DeviceStatus?

    func loadArticles() async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await APIClient.shared.fetchArticles()
            articles = response.articles
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func loadDeviceStatus() async {
        deviceStatus = try? await APIClient.shared.fetchDeviceStatus()
    }

    /// Returns true when a new article arrived (directly or recovered after a dropped connection).
    @discardableResult
    func generateArticle(proficiencyLevel: String? = nil, newWordsCount: Int? = nil, targetWordCount: Int? = nil, writingSystem: String? = nil, topic: String? = nil) async -> Bool {
        isGenerating = true
        generationStartedAt = Date()
        generatingMinimized = false
        errorMessage = nil
        var succeeded = false
        defer {
            isGenerating = false
            generationStartedAt = nil
        }
        // Snapshot the top article ID so we can detect new arrivals after a network error
        let previousTopId = articles.first?.id
        do {
            let newArticle = try await APIClient.shared.generateArticle(
                proficiencyLevel: proficiencyLevel,
                newWordsCount: newWordsCount,
                targetWordCount: targetWordCount,
                writingSystem: writingSystem,
                topic: topic
            )
            articles.insert(newArticle, at: 0)
            succeeded = true
            // Refresh trial counter after a successful generation
            await loadDeviceStatus()
        } catch APIError.trialExhausted {
            // Hard paywall: show upgrade screen instead of a generic error
            showPaywall = true
        } catch {
            // Network errors often happen when the user backgrounds the app during generation.
            // The server keeps working and saves the article — wait for it before showing an error.
            // A server error (HTTP 5xx) means generation itself failed, so only check once.
            let connectionDropped = error is URLError
            succeeded = await recoverAfterNetworkError(previousTopId: previousTopId, keepWaiting: connectionDropped)
            if !succeeded {
                errorMessage = error.localizedDescription
            }
        }
        return succeeded
    }

    /// After a network error during generation, re-fetch articles to see if the server
    /// actually completed. If a new article appeared, silently recover instead of showing an error.
    /// With `keepWaiting` (connection dropped, e.g. app was in the background) it checks every
    /// 10 seconds for up to 4 minutes, since the server may still be writing the article.
    private func recoverAfterNetworkError(previousTopId: Int?, keepWaiting: Bool) async -> Bool {
        let attempts = keepWaiting ? 24 : 1
        for attempt in 0..<attempts {
            // First check after a brief pause — the server may still be writing to Firestore
            try? await Task.sleep(nanoseconds: attempt == 0 ? 2_000_000_000 : 10_000_000_000)
            if let response = try? await APIClient.shared.fetchArticles(),
               let newTopId = response.articles.first?.id, newTopId != previousTopId {
                // A new article appeared that wasn't there before — the server succeeded
                articles = response.articles
                await loadDeviceStatus()
                return true
            }
        }
        return false
    }

    func deleteArticle(id: Int, deleteVocabulary: Bool) async {
        do {
            try await APIClient.shared.deleteArticle(id: id, deleteVocabulary: deleteVocabulary)
            articles.removeAll { $0.id == id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ArticleFeedView: View {
    @State private var viewModel = ArticleFeedViewModel()
    @State private var showGenerateSheet = false
    @State private var articleToDelete: Article?
    @State private var showDeleteConfirmation = false

    // StoreKit review prompt — shown once, immediately after the first successful generation
    @Environment(\.requestReview) private var requestReview
    @AppStorage("hasPromptedForFirstReview") private var hasPromptedForFirstReview = false

    var body: some View {
        // Read RevenueCat offering so SwiftUI re-renders banner when prices load
        let _ = RevenueCatService.shared.currentOffering

        ZStack {
            List {
                // Upsell banner — show unless confirmed Pro subscriber
                if viewModel.deviceStatus?.isPro != true {
                    Section {
                        Button {
                            viewModel.showPaywall = true
                        } label: {
                            ProUpsellBanner()
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                    }
                }

                // Generation running while the learner reads other articles
                if viewModel.isGenerating && viewModel.generatingMinimized {
                    GeneratingBanner {
                        withAnimation { viewModel.generatingMinimized = false }
                    }
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }

                ForEach(viewModel.articles) { article in
                    NavigationLink(destination: ArticleDetailView(articleId: article.id)) {
                        ArticleCard(article: article)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            articleToDelete = article
                            showDeleteConfirmation = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .listStyle(.plain)
            .refreshable {
                await viewModel.loadArticles()
            }

            .overlay {
                if viewModel.articles.isEmpty && !viewModel.isLoading {
                    ContentUnavailableView(
                        "No Articles Yet",
                        systemImage: "doc.text",
                        description: Text("Tap + to generate your first article")
                    )
                }
            }

            // Floating generate button
            VStack {
                Spacer()
                HStack {
                    // Trial counter badge (hidden for Pro users)
                    if let status = viewModel.deviceStatus, !status.isPro,
                       let remaining = status.trialsRemaining {
                        Spacer()
                        trialBadge(remaining: remaining)
                            .padding(.leading, 20)
                    }

                    Spacer()
                    Button {
                        if let status = viewModel.deviceStatus,
                           !status.isPro,
                           let remaining = status.trialsRemaining,
                           remaining == 0 {
                            // No slots left — open paywall directly without hitting the server
                            viewModel.showPaywall = true
                        } else {
                            showGenerateSheet = true
                        }
                    } label: {
                        Image(systemName: "plus")
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(Color.accentColor)
                            .clipShape(Circle())
                            .shadow(radius: 4, y: 2)
                    }
                    .padding(.trailing, 20)
                    .padding(.bottom, 20)
                    .disabled(viewModel.isGenerating)
                    .opacity(viewModel.isGenerating ? 0.4 : 1)
                }
            }

            // Full "writing your article" screen while generating
            if viewModel.isGenerating && !viewModel.generatingMinimized {
                GeneratingView(startedAt: viewModel.generationStartedAt ?? Date()) {
                    withAnimation { viewModel.generatingMinimized = true }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.isGenerating)
        .navigationTitle("Articles")
        .task {
            await viewModel.loadArticles()
            await viewModel.loadDeviceStatus()
            // Pre-load RevenueCat offerings so the upsell banner shows localized prices
            try? await RevenueCatService.shared.loadOfferings()
        }
        .sheet(isPresented: $showGenerateSheet) {
            GenerateArticleSheet(viewModel: viewModel, onSuccess: {
                // Only prompt once and only on the success path (never on error or paywall)
                guard !hasPromptedForFirstReview else { return }
                hasPromptedForFirstReview = true
                requestReview()
            })
        }
        .sheet(isPresented: $viewModel.showPaywall) {
            PaywallView(trialsRemaining: viewModel.deviceStatus?.trialsRemaining, onUpgradeSuccess: {
                viewModel.showPaywall = false
                Task { await viewModel.loadDeviceStatus() }
            })
        }
        .alert("Error", isPresented: .init(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .confirmationDialog(
            "Delete Article",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete article only", role: .destructive) {
                if let article = articleToDelete {
                    Task { await viewModel.deleteArticle(id: article.id, deleteVocabulary: false) }
                }
            }
            Button("Delete article and its vocabulary", role: .destructive) {
                if let article = articleToDelete {
                    Task { await viewModel.deleteArticle(id: article.id, deleteVocabulary: true) }
                }
            }
            Button("Cancel", role: .cancel) {
                articleToDelete = nil
            }
        } message: {
            if let article = articleToDelete {
                Text("Delete \"\(stripMarkers(article.titleRomaji))\"?\n\nYou can keep the vocabulary words for future review or delete them too.")
            }
        }
    }

    // Small pill showing remaining free slots
    @ViewBuilder
    private func trialBadge(remaining: Int) -> some View {
        HStack(spacing: 4) {
            Image(systemName: remaining > 0 ? "sparkles" : "lock.fill")
                .font(.caption2)
            Text(remaining > 0
                 ? "\(remaining) free \(remaining == 1 ? "article" : "articles") left"
                 : "Upgrade to continue")
                .font(.caption.weight(.medium))
        }
        .foregroundStyle(remaining > 0 ? Color.orange : Color.red)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: Capsule())
        .padding(.bottom, 20)
    }
}

// MARK: - Pro Upsell Banner

struct ProUpsellBanner: View {
    private let rc = RevenueCatService.shared

    /// Whether RevenueCat offerings have loaded with real prices
    private var hasLoadedPrices: Bool {
        rc.monthlyPackage != nil && rc.annualPackage != nil
    }

    /// Localized monthly price string (e.g. "$7.99/mo", "€8.99/mo", "¥1,300/mo")
    private var monthlyPrice: String? {
        guard let pkg = rc.monthlyPackage else { return nil }
        return "\(pkg.localizedPriceString)/mo"
    }

    /// Localized annual per-month equivalent (e.g. "$5.83/mo", "€5.56/mo")
    private var annualPerMonth: String? {
        guard let annual = rc.annualPackage else { return nil }
        let perMonth = annual.storeProduct.price / 12
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = annual.storeProduct.priceFormatter?.locale ?? .current
        return formatter.string(from: perMonth as NSDecimalNumber).map { "\($0)/mo" }
    }

    /// Savings percentage: how much cheaper annual is vs 12x monthly
    private var savingsText: String? {
        guard let annual = rc.annualPackage, let monthly = rc.monthlyPackage else { return nil }
        let yearlyIfMonthly = (monthly.storeProduct.price as NSDecimalNumber).doubleValue * 12.0
        let annualPrice = (annual.storeProduct.price as NSDecimalNumber).doubleValue
        guard yearlyIfMonthly > 0 else { return nil }
        let pct = Int(((yearlyIfMonthly - annualPrice) / yearlyIfMonthly * 100.0).rounded())
        return pct > 0 ? "Save \(pct)%" : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                // Header
                HStack(spacing: 8) {
                    Image(systemName: "star.fill")
                        .font(.subheadline)
                        .foregroundStyle(.yellow)
                    Text("Upgrade to Pro")
                        .font(.subheadline.weight(.bold))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                // Value proposition
                Text("Unlimited articles, vocabulary tracking, and quizzes. Learn at your own pace with fresh news every day.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                // Pricing row — only show when real prices have loaded
                if hasLoadedPrices {
                    HStack(spacing: 16) {
                        // Monthly
                        VStack(spacing: 2) {
                            Text("Monthly")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(monthlyPrice ?? "")
                                .font(.caption.weight(.semibold))
                        }

                        Rectangle()
                            .fill(Color(.separator))
                            .frame(width: 1, height: 28)

                        // Annual — highlighted
                        VStack(spacing: 2) {
                            Text("Annual")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(annualPerMonth ?? "")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Color.accentColor)
                        }

                        if let savings = savingsText {
                            Text(savings)
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Color.accentColor.opacity(0.12))
                                .foregroundStyle(Color.accentColor)
                                .clipShape(Capsule())
                        }

                        Spacer()
                    }
                } else {
                    // Prices not yet loaded — show generic prompt
                    Text("Monthly and annual plans available. Save with annual.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Cancel note
                Text("Cancel anytime. No commitment.")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }
}

struct GenerateArticleSheet: View {
    @Bindable var viewModel: ArticleFeedViewModel
    /// Called once, immediately after a successful generation (no error, no paywall).
    /// Used by ArticleFeedView to trigger the StoreKit review prompt at the right moment.
    var onSuccess: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var selectedLevel = "N3"
    @State private var newWordsCount = 12
    @State private var targetWordCount = 200
    @State private var selectedWritingSystem = "romaji"
    @State private var customTopic = ""
    @State private var configLoaded = false

    let levels = ["N5", "N4", "N3", "N2", "N1"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Writing System") {
                    Picker("Writing System", selection: $selectedWritingSystem) {
                        Text("Romaji").tag("romaji")
                        Text("\u{3072}\u{3089}\u{304C}\u{306A}").tag("kana")
                        Text("\u{6F22}\u{5B57}").tag("kanji")
                    }
                    .pickerStyle(.segmented)
                }

                Section("JLPT Level") {
                    Picker("Level", selection: $selectedLevel) {
                        ForEach(levels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Article Length") {
                    Stepper("\(targetWordCount) words", value: $targetWordCount, in: 100...500, step: 50)
                }

                Section("New Words") {
                    Stepper("\(newWordsCount) new words", value: $newWordsCount, in: 5...25)
                }

                Section {
                    TextField("e.g. Tokyo Olympics, AI startups...", text: $customTopic)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Topic (Optional)")
                } footer: {
                    Text("Leave empty to get a random news article from your interests.")
                }

                Section {
                    Button {
                        // Close the form at once; the feed shows the generating screen.
                        // The task outlives this sheet, so the article still arrives.
                        let feed = viewModel
                        let onSuccess = onSuccess
                        let topic = customTopic.isEmpty ? nil : customTopic
                        Task {
                            let succeeded = await feed.generateArticle(
                                proficiencyLevel: selectedLevel,
                                newWordsCount: newWordsCount,
                                targetWordCount: targetWordCount,
                                writingSystem: selectedWritingSystem,
                                topic: topic
                            )
                            if succeeded { onSuccess?() }
                        }
                        dismiss()
                    } label: {
                        Label("Generate Article", systemImage: "sparkles")
                    }
                    .disabled(viewModel.isGenerating)
                } footer: {
                    Text("Takes 1–3 minutes. You can leave the app while it works.")
                }
            }
            .navigationTitle("New Article")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                if !configLoaded {
                    if let config = try? await APIClient.shared.fetchConfig() {
                        selectedLevel = config.proficiencyLevel
                        newWordsCount = config.newWordsPerArticle
                        targetWordCount = config.targetWordCount
                        selectedWritingSystem = config.writingSystem
                    }
                    configLoaded = true
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ArticleFeedView()
    }
}
