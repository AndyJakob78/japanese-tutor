import SwiftUI

// MARK: - OnboardingViewModel

@Observable
class OnboardingViewModel {
    // Step tracking
    var currentStep: Int = 0
    let totalSteps = 4

    // Step 1 — Topics (max 8)
    var selectedTopics: Set<String> = []
    var customTopicInput: String = ""

    // Step 2 — Regions (max 10)
    var selectedRegions: Set<String> = []
    var customRegionInput: String = ""

    // Step 3 — JLPT Level (always has a value)
    var selectedLevel: String = "N5"

    // Step 4 — Writing System (always has a value)
    var selectedWritingSystem: String = "romaji"

    // Celebration + saving state
    var showCelebration: Bool = false
    var isSaving: Bool = false
    var saveError: String?
    var showCompletion: Bool = false
    var isReadyToFinish: Bool = false

    // MARK: Predefined options

    let predefinedTopics = [
        "politics", "technology", "finance", "sport",
        "science", "culture", "environment", "health"
    ]

    let predefinedRegions = [
        "Japan", "Germany", "United States", "France",
        "United Kingdom", "South Korea", "China",
        "Brazil", "India", "Australia"
    ]

    // MARK: Validation — Continue button is enabled when this is true

    var currentStepIsValid: Bool {
        switch currentStep {
        case 0: return !selectedTopics.isEmpty
        case 1: return !selectedRegions.isEmpty
        case 2: return true   // N5 pre-selected
        case 3: return true   // romaji pre-selected
        default: return false
        }
    }

    // MARK: Topic mutations

    func toggleTopic(_ topic: String) {
        let key = topic.lowercased()
        if selectedTopics.contains(key) {
            selectedTopics.remove(key)
        } else if selectedTopics.count < 8 {
            selectedTopics.insert(key)
        }
    }

    func addCustomTopic() {
        let trimmed = customTopicInput.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty,
              !selectedTopics.contains(trimmed),
              selectedTopics.count < 8 else { return }
        selectedTopics.insert(trimmed)
        customTopicInput = ""
    }

    // MARK: Region mutations

    func toggleRegion(_ region: String) {
        let key = region.lowercased()
        if selectedRegions.contains(key) {
            selectedRegions.remove(key)
        } else if selectedRegions.count < 10 {
            selectedRegions.insert(key)
        }
    }

    func addCustomRegion() {
        let trimmed = customRegionInput.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty,
              !selectedRegions.contains(trimmed),
              selectedRegions.count < 10 else { return }
        selectedRegions.insert(trimmed)
        customRegionInput = ""
    }

    // MARK: Skip — fill sensible defaults when user skips a step empty

    func skipCurrentStep() {
        switch currentStep {
        case 0:
            if selectedTopics.isEmpty {
                selectedTopics = ["politics", "technology", "finance", "sport"]
            }
        case 1:
            if selectedRegions.isEmpty {
                selectedRegions = ["japan", "germany", "united states"]
            }
        default:
            break   // level and writing system already have defaults
        }
    }

    // MARK: Step advancement

    func advanceStep() {
        guard currentStep < totalSteps - 1 else { return }
        currentStep += 1
        showCelebration = false
    }

    // MARK: Config payload — matches keys used in ConfigView.saveConfig()

    func buildConfigPayload() -> [String: Any] {
        [
            "topics":            Array(selectedTopics.sorted()),
            "regions":           Array(selectedRegions.sorted()),
            "proficiency_level": selectedLevel,
            "writing_system":    selectedWritingSystem,
        ]
    }
}

// MARK: - OnboardingFlowView (container)

struct OnboardingFlowView: View {
    @State private var vm = OnboardingViewModel()
    var onComplete: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            if vm.showCompletion {
                // Completion screen — congratulatory + auto-generate
                OnboardingCompletionView(vm: vm)
                    .transition(.opacity)
            } else {
                // Step content — slides in from the right on each advance
                Group {
                    switch vm.currentStep {
                    case 0:
                        OnboardingTopicsView(vm: vm)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal:   .move(edge: .leading)
                            ))
                    case 1:
                        OnboardingRegionsView(vm: vm)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal:   .move(edge: .leading)
                            ))
                    case 2:
                        OnboardingLevelView(vm: vm)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal:   .move(edge: .leading)
                            ))
                    case 3:
                        OnboardingWritingSystemView(vm: vm)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal:   .move(edge: .leading)
                            ))
                    default:
                        EmptyView()
                    }
                }
                .animation(.easeInOut(duration: 0.35), value: vm.currentStep)

                // Fixed bottom chrome (always above content)
                bottomChrome
            }
        }
        .animation(.easeInOut(duration: 0.4), value: vm.showCompletion)
        .ignoresSafeArea(edges: .bottom)
        .onChange(of: vm.isReadyToFinish) { _, ready in
            if ready { onComplete() }
        }
    }

    // MARK: Bottom chrome

    private var bottomChrome: some View {
        VStack(spacing: 12) {
            // Step progress dots
            HStack(spacing: 8) {
                ForEach(0..<vm.totalSteps, id: \.self) { i in
                    Circle()
                        .fill(i == vm.currentStep ? Color.accentColor : Color.gray.opacity(0.3))
                        .frame(
                            width:  i == vm.currentStep ? 10 : 7,
                            height: i == vm.currentStep ? 10 : 7
                        )
                        .animation(.spring(response: 0.3), value: vm.currentStep)
                }
            }
            .padding(.bottom, 2)

            // Error message (shown when final step save fails)
            if let error = vm.saveError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            // Continue / Get Started button
            Button {
                handleContinue()
            } label: {
                Group {
                    if vm.isSaving {
                        ProgressView().tint(.white)
                    } else {
                        Text(vm.currentStep == vm.totalSteps - 1 ? "Get Started" : "Continue")
                            .font(.headline)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .foregroundStyle(.white)
                .background(
                    vm.currentStepIsValid
                        ? Color.accentColor
                        : Color.accentColor.opacity(0.35)
                )
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(!vm.currentStepIsValid || vm.isSaving)
            .padding(.horizontal, 24)

            // Skip — subtle tertiary link
            Button {
                handleSkip()
            } label: {
                Text("Skip")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.bottom, 36)
        }
        .padding(.top, 16)
        .background(.regularMaterial)
    }

    // MARK: Actions

    private func handleContinue() {
        vm.saveError = nil
        withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
            vm.showCelebration = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            if vm.currentStep == vm.totalSteps - 1 {
                Task { await finishOnboarding() }
            } else {
                withAnimation { vm.advanceStep() }
            }
        }
    }

    private func handleSkip() {
        vm.skipCurrentStep()
        vm.saveError = nil
        if vm.currentStep == vm.totalSteps - 1 {
            Task { await finishOnboarding() }
        } else {
            withAnimation { vm.advanceStep() }
        }
    }

    private func finishOnboarding() async {
        vm.isSaving = true
        do {
            try await APIClient.shared.updateConfig(vm.buildConfigPayload())
            UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
            await MainActor.run {
                vm.isSaving = false
                vm.showCompletion = true
            }
        } catch {
            vm.saveError = error.localizedDescription
            vm.isSaving = false
        }
    }
}

// MARK: - CelebrationView

struct CelebrationView: View {
    let isShowing: Bool

    @State private var ringScale:  CGFloat = 0.3
    @State private var checkScale: CGFloat = 0.1
    @State private var textOpacity: Double = 0

    var body: some View {
        ZStack {
            // Very subtle background dim — doesn't block content
            Color.black.opacity(isShowing ? 0.06 : 0)
                .ignoresSafeArea()
                .animation(.easeIn(duration: 0.15), value: isShowing)

            if isShowing {
                VStack(spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(Color.green.opacity(0.15))
                            .frame(width: 100, height: 100)
                            .scaleEffect(ringScale)

                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 58, weight: .medium))
                            .foregroundStyle(.green)
                            .scaleEffect(checkScale)
                    }

                    Text("Well done! 🎉")
                        .font(.title3.weight(.bold))
                        .opacity(textOpacity)
                }
                .onAppear {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.55)) {
                        ringScale  = 1.0
                        checkScale = 1.0
                    }
                    withAnimation(.easeIn(duration: 0.25).delay(0.2)) {
                        textOpacity = 1.0
                    }
                }
                .onDisappear {
                    // Reset so animation replays for next step
                    ringScale   = 0.3
                    checkScale  = 0.1
                    textOpacity = 0
                }
                .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35), value: isShowing)
        .allowsHitTesting(false)
    }
}

// MARK: - ChipGridView

struct ChipGridView: View {
    let items: [String]
    let isSelected: (String) -> Bool
    let isDisabled: (String) -> Bool
    let onTap: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 105), spacing: 8)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button {
                    onTap(item)
                } label: {
                    Text(item.capitalized)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity)
                        .background(isSelected(item) ? Color.accentColor : Color(.systemGray5))
                        .foregroundStyle(isSelected(item) ? .white : .primary)
                        .clipShape(Capsule())
                        .opacity(isDisabled(item) ? 0.4 : 1.0)
                }
                .disabled(isDisabled(item))
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.15), value: isSelected(item))
            }
        }
    }
}

// MARK: - heroIcon helper

@ViewBuilder
func onboardingHeroIcon(systemImage: String) -> some View {
    ZStack {
        Circle()
            .fill(Color.accentColor.opacity(0.12))
            .frame(width: 96, height: 96)
        Image(systemName: systemImage)
            .font(.system(size: 44, weight: .semibold))
            .foregroundStyle(Color.accentColor)
    }
}

// MARK: - Preview

#Preview {
    OnboardingFlowView { }
}
