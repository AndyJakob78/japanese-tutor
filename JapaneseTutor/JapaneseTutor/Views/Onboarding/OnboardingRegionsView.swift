import SwiftUI

struct OnboardingRegionsView: View {
    @Bindable var vm: OnboardingViewModel

    /// Custom regions that aren't in the predefined list
    private var customRegions: [String] {
        let predefinedLower = Set(vm.predefinedRegions.map { $0.lowercased() })
        return vm.selectedRegions
            .filter { !predefinedLower.contains($0) }
            .sorted()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                onboardingHeroIcon(systemImage: "globe.europe.africa.fill")
                    .padding(.top, 40)

                VStack(spacing: 8) {
                    Text("Which regions matter to you?")
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)
                    Text("Up to 10 regions — country, state, prefecture, or city.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                ChipGridView(
                    items: vm.predefinedRegions,
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
                                    Text(region.capitalized)
                                        .font(.subheadline.weight(.medium))
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
                        TextField("Add a country, city, or region…", text: $vm.customRegionInput)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color(.systemGray6))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .onSubmit { vm.addCustomRegion() }

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

                Text("\(vm.selectedRegions.count) of 10 selected")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                CelebrationView(isShowing: vm.showCelebration)

                Spacer(minLength: 0)
            }
            .padding(.bottom, 200)
        }
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.bottom)
    }
}

#Preview {
    OnboardingRegionsView(vm: OnboardingViewModel())
}
