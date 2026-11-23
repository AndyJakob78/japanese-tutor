import SwiftUI

struct OnboardingTopicsView: View {
    @Bindable var vm: OnboardingViewModel

    /// Custom topics that aren't in the predefined list
    private var customTopics: [String] {
        vm.selectedTopics
            .filter { !vm.predefinedTopics.contains($0) }
            .sorted()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                onboardingHeroSheep("ChapterReading")
                    .padding(.top, 40)


                VStack(spacing: 8) {
                    Text(L("What topics interest you?", "どんなテーマに興味がありますか？"))
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                    Text(L("Choose up to 8 — or add your own. Articles come from news about these.", "8つまで選べます。自分のテーマも追加できます。選んだテーマのニュースから記事を作ります。"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                ChipGridView(
                    items: vm.predefinedTopics,
                    label: Labels.topic,
                    isSelected: { vm.selectedTopics.contains($0.lowercased()) },
                    isDisabled: { topic in
                        !vm.selectedTopics.contains(topic.lowercased())
                            && vm.selectedTopics.count >= 8
                    },
                    onTap: { vm.toggleTopic($0) }
                )
                .padding(.horizontal, 24)

                // Show custom topics as removable chips
                if !customTopics.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 105), spacing: 8)], spacing: 8) {
                        ForEach(customTopics, id: \.self) { topic in
                            Button {
                                vm.selectedTopics.remove(topic)
                            } label: {
                                HStack(spacing: 4) {
                                    Text(Labels.topic(topic))
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

                // Custom topic input — hidden when limit reached
                if vm.selectedTopics.count < 8 {
                    HStack(spacing: 10) {
                        TextField(L("Add your own topic…", "自分のテーマを追加…"), text: $vm.customTopicInput)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color.cardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .onSubmit { vm.addCustomTopic() }

                        Button {
                            UIApplication.shared.sendAction(
                                #selector(UIResponder.resignFirstResponder),
                                to: nil, from: nil, for: nil
                            )
                            vm.addCustomTopic()
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title2)
                                .foregroundStyle(
                                    vm.customTopicInput.trimmingCharacters(in: .whitespaces).isEmpty
                                        ? Color.accentColor.opacity(0.35)
                                        : Color.accentColor
                                )
                        }
                        .disabled(vm.customTopicInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(.horizontal, 24)
                }

                Text(L("\(vm.selectedTopics.count) of 8 selected", "\(vm.selectedTopics.count) / 8 選択中"))
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
    OnboardingTopicsView(vm: OnboardingViewModel())
}
