import SwiftUI

struct OnboardingCompletionView: View {
    @Bindable var vm: OnboardingViewModel

    @State private var showCheckmark = false
    @State private var showText = false
    @State private var showProgress = false
    @State private var hasArticleReady = false
    @State private var statusMessage: String?
    @State private var isFinished = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 20) {
                // Animated checkmark
                ZStack {
                    Circle()
                        .fill(Color.green.opacity(0.12))
                        .frame(width: 120, height: 120)
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 72, weight: .medium))
                        .foregroundStyle(.green)
                }
                .scaleEffect(showCheckmark ? 1.0 : 0.2)
                .opacity(showCheckmark ? 1 : 0)

                VStack(spacing: 10) {
                    Text("You're all set! 🎉")
                        .font(.title.weight(.bold))
                        .opacity(showText ? 1 : 0)

                    Text(hasArticleReady
                         ? "Great choices! Your article is ready."
                         : "Great choices! We're generating your first article right now based on your interests.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                        .opacity(showText ? 1 : 0)
                }

                // Generation progress
                if showProgress {
                    VStack(spacing: 12) {
                        if isFinished && hasArticleReady {
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                Text(statusMessage ?? "Your first article is ready!")
                                    .font(.subheadline.weight(.medium))
                            }
                            .transition(.scale.combined(with: .opacity))
                        } else if isFinished {
                            // Finished but no article — let them continue
                            HStack(spacing: 6) {
                                Image(systemName: "info.circle.fill")
                                    .foregroundStyle(.secondary)
                                Text(statusMessage ?? "You can generate articles from the main screen.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            HStack(spacing: 10) {
                                ProgressView()
                                Text("Generating article…")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .animation(.easeInOut(duration: 0.3), value: isFinished)
                    .animation(.easeInOut(duration: 0.3), value: hasArticleReady)
                    .padding(.top, 8)
                }
            }

            Spacer()

            // Bottom section
            VStack(spacing: 12) {
                if isFinished {
                    Button {
                        vm.isReadyToFinish = true
                    } label: {
                        Text(hasArticleReady ? "Start Reading" : "Enter App")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .foregroundStyle(.white)
                            .background(Color.accentColor)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))

                    if hasArticleReady {
                        Text("Your learning journey starts now!")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                } else {
                    // Still generating — friendly wait message
                    Text("Hang tight — this usually takes about a minute ☕")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: isFinished)
            .padding(.bottom, 36)
        }
        .task {
            // Animate entrance
            withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) {
                showCheckmark = true
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
            withAnimation(.easeIn(duration: 0.3)) {
                showText = true
            }
            try? await Task.sleep(nanoseconds: 400_000_000)
            withAnimation(.easeIn(duration: 0.2)) {
                showProgress = true
            }

            // Try to generate or fall back to existing articles
            await prepareFirstArticle()
        }
    }

    private func prepareFirstArticle() async {
        // Step 1: Try generating a new article
        do {
            let _ = try await APIClient.shared.generateArticle()
            await MainActor.run {
                withAnimation {
                    hasArticleReady = true
                    statusMessage = "Your first article is ready!"
                    isFinished = true
                }
            }
            return
        } catch APIError.trialExhausted {
            // Trial exhausted — check if there are existing articles from before
            print("[Onboarding] Trial exhausted, checking for existing articles…")
        } catch {
            // Other error (server down, timeout, etc) — check for existing articles
            print("[Onboarding] Generation failed: \(error.localizedDescription), checking for existing articles…")
        }

        // Step 2: Fallback — check if device already has articles
        do {
            let response = try await APIClient.shared.fetchArticles()
            if !response.articles.isEmpty {
                await MainActor.run {
                    withAnimation {
                        hasArticleReady = true
                        statusMessage = "Your articles are ready!"
                        isFinished = true
                    }
                }
                return
            }
        } catch {
            print("[Onboarding] Failed to fetch articles: \(error.localizedDescription)")
        }

        // Step 3: Neither generation nor existing articles — let them continue anyway
        await MainActor.run {
            withAnimation {
                statusMessage = "You can generate articles from the main screen."
                isFinished = true
            }
        }
    }
}

#Preview {
    OnboardingCompletionView(vm: OnboardingViewModel())
}
