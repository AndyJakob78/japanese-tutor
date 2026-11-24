import SwiftUI

struct OnboardingRegionsView: View {
    @Bindable var vm: OnboardingViewModel

    @State private var placeFinder = PlaceFinder()
    @State private var locating = false
    @State private var locationFailed = false

    /// The own-entry field: when it gets the keyboard, it is scrolled into view above it
    @FocusState private var fieldFocused: Bool

    /// The phone's time zone city and country first, then the course's usual places.
    private var suggestions: [String] {
        var out: [String] = []
        for p in PlaceFinder.timeZoneSuggestions() + vm.predefinedRegions where !out.contains(where: { $0.lowercased() == p.lowercased() }) {
            out.append(p)
        }
        return out
    }

    /// Custom regions that aren't in the suggestions
    private var customRegions: [String] {
        let predefinedLower = Set(suggestions.map { $0.lowercased() })
        return vm.selectedRegions
            .filter { !predefinedLower.contains($0) }
            .sorted()
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(spacing: 24) {
                onboardingHeroSheep("ChapterLost")
                    .padding(.top, 40)

                VStack(spacing: 8) {
                    Text(L("Where do you live — and which places interest you?", "どこに住んでいますか？\n気になる場所は？"))
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                    Text(L("Any place works: country, state, city or village. Up to 10.", "国、州、市、村 — どこでも大丈夫です。10か所まで選べます。"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                // Use my location — approximate, once; only the place names are kept
                Button {
                    Task {
                        locating = true
                        let found = await placeFinder.currentPlaces()
                        locating = false
                        if found.isEmpty { locationFailed = true }
                        for place in found where vm.selectedRegions.count < 10 { vm.selectedRegions.insert(place.lowercased()) }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if locating { ProgressView() } else { Image(systemName: "location.fill") }
                        Text(L("Use my location", "現在地を使う"))
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.cardBackground, in: Capsule())
                    .overlay(Capsule().stroke(Color.accentColor.opacity(0.5), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(locating)
                if locationFailed {
                    Text(L("Location is not available — type your town below.", "現在地がわかりませんでした。下に町の名前を入力してください。"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                ChipGridView(
                    items: suggestions,
                    label: Labels.region,
                    isSelected: { vm.selectedRegions.contains($0.lowercased()) },
                    isDisabled: { region in
                        !vm.selectedRegions.contains(region.lowercased())
                            && vm.selectedRegions.count >= 10
                    },
                    onTap: { vm.toggleRegion($0) }
                )
                .padding(.horizontal, 24)

                // Show custom regions as removable chips
                if !customRegions.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 105), spacing: 8)], spacing: 8) {
                        ForEach(customRegions, id: \.self) { region in
                            Button {
                                vm.selectedRegions.remove(region)
                            } label: {
                                HStack(spacing: 4) {
                                    Text(Labels.region(region))
                                        .font(.subheadline.weight(.medium))
                                        .lineLimit(1)
                                        .fixedSize()
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.caption)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Color.accentColor)
                                .foregroundStyle(.white)
                                .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                }

                // Custom region input — hidden when limit reached
                if vm.selectedRegions.count < 10 {
                    HStack(spacing: 10) {
                        TextField(L("Add a town, city, state or country…", "町、市、州、国を追加…"), text: $vm.customRegionInput)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color.cardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .onSubmit { vm.addCustomRegion() }
                            .focused($fieldFocused)
                            .id("ownEntry")

                        Button {
                            UIApplication.shared.sendAction(
                                #selector(UIResponder.resignFirstResponder),
                                to: nil, from: nil, for: nil
                            )
                            vm.addCustomRegion()
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title2)
                                .foregroundStyle(
                                    vm.customRegionInput.trimmingCharacters(in: .whitespaces).isEmpty
                                        ? Color.accentColor.opacity(0.35)
                                        : Color.accentColor
                                )
                        }
                        .disabled(vm.customRegionInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(.horizontal, 24)
                }

                Text(L("\(vm.selectedRegions.count) of 10 selected", "\(vm.selectedRegions.count) / 10 選択中"))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                CelebrationView(isShowing: vm.showCelebration)

                Spacer(minLength: 0)
            }
            .padding(.bottom, 200)
        }
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.bottom)
        .onChange(of: fieldFocused) { _, on in
            guard on else { return }
            // wait for the keyboard to finish rising, then show the field just above it
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("ownEntry", anchor: .bottom) }
            }
        }
        }
    }
}

#Preview {
    OnboardingRegionsView(vm: OnboardingViewModel())
}
