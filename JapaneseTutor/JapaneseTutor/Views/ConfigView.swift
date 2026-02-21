import SwiftUI

@Observable
class ConfigViewModel {
    var config: AppConfig = .default
    var isLoading = false
    var isSaving = false
    var errorMessage: String?
    var savedMessage: String?

    let levels = ["N5", "N4", "N3", "N2", "N1"]

    func loadConfig() async {
        isLoading = true
        do {
            config = try await APIClient.shared.fetchConfig()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func saveConfig() async {
        isSaving = true
        do {
            let updates: [String: Any] = [
                "proficiency_level": config.proficiencyLevel,
                "max_sentence_length": config.maxSentenceLength,
                "new_words_per_article": config.newWordsPerArticle,
                "target_word_count": config.targetWordCount,
                "reuse_ratio": config.reuseRatio,
                "topics": config.topics,
                "regions": config.regions,
                "news_timeframe_hours": config.newsTimeframeHours,
                "quiz_questions_count": config.quizQuestionsCount,
                "writing_system": config.writingSystem,
            ]
            try await APIClient.shared.updateConfig(updates)
            savedMessage = "Settings saved"
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    // MARK: - Topics

    func addTopic(_ topic: String) {
        let trimmed = topic.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty,
              !config.topics.contains(trimmed),
              config.topics.count < 10 else { return }
        config.topics.append(trimmed)
    }

    func deleteTopic(at offsets: IndexSet) {
        config.topics.remove(atOffsets: offsets)
    }

    func updateTopic(at index: Int, with newValue: String) {
        let trimmed = newValue.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty,
              index < config.topics.count else { return }
        // Don't allow duplicates
        if config.topics.enumerated().contains(where: { $0.offset != index && $0.element == trimmed }) { return }
        config.topics[index] = trimmed
    }

    // MARK: - Regions

    func addRegion(_ region: String) {
        let trimmed = region.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty,
              !config.regions.contains(trimmed),
              config.regions.count < 10 else { return }
        config.regions.append(trimmed)
    }

    func deleteRegion(at offsets: IndexSet) {
        config.regions.remove(atOffsets: offsets)
    }

    func updateRegion(at index: Int, with newValue: String) {
        let trimmed = newValue.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty,
              index < config.regions.count else { return }
        if config.regions.enumerated().contains(where: { $0.offset != index && $0.element == trimmed }) { return }
        config.regions[index] = trimmed
    }
}

struct ConfigView: View {
    @State private var viewModel = ConfigViewModel()

    var body: some View {
        Form {
            if viewModel.isLoading {
                Section {
                    ProgressView("Loading settings...")
                }
            } else {
                // Writing System
                Section {
                    Picker("Writing System", selection: $viewModel.config.writingSystem) {
                        Text("Romaji").tag("romaji")
                        Text("\u{3072}\u{3089}\u{304C}\u{306A}").tag("kana")
                        Text("\u{6F22}\u{5B57}").tag("kanji")
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Writing System")
                } footer: {
                    Text("Romaji for beginners, Kana for intermediate, Kanji for advanced learners.")
                }

                // JLPT Level
                Section("Proficiency Level") {
                    Picker("JLPT Level", selection: $viewModel.config.proficiencyLevel) {
                        ForEach(viewModel.levels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                // Topics — editable list
                Section {
                    ForEach(Array(viewModel.config.topics.enumerated()), id: \.offset) { index, topic in
                        EditableListRow(
                            value: topic,
                            onSave: { newValue in
                                viewModel.updateTopic(at: index, with: newValue)
                            }
                        )
                    }
                    .onDelete { offsets in
                        viewModel.deleteTopic(at: offsets)
                    }

                    if viewModel.config.topics.count < 10 {
                        AddItemRow(placeholder: "e.g. sports, art, food...") { newTopic in
                            viewModel.addTopic(newTopic)
                        }
                    }
                } header: {
                    Text("Topics of Interest")
                } footer: {
                    Text("\(viewModel.config.topics.count)/10 topics. Swipe to delete, tap to edit.")
                }

                // Regions — editable list
                Section {
                    ForEach(Array(viewModel.config.regions.enumerated()), id: \.offset) { index, region in
                        EditableListRow(
                            value: region,
                            onSave: { newValue in
                                viewModel.updateRegion(at: index, with: newValue)
                            }
                        )
                    }
                    .onDelete { offsets in
                        viewModel.deleteRegion(at: offsets)
                    }

                    if viewModel.config.regions.count < 10 {
                        AddItemRow(placeholder: "e.g. Tokyo, Bavaria, California...") { newRegion in
                            viewModel.addRegion(newRegion)
                        }
                    }
                } header: {
                    Text("Regions")
                } footer: {
                    Text("\(viewModel.config.regions.count)/10 regions. Can be a country, state, prefecture, or city.")
                }

                // Article settings
                Section("Article") {
                    Stepper(
                        "Article length: \(viewModel.config.targetWordCount) words",
                        value: $viewModel.config.targetWordCount,
                        in: 100...500,
                        step: 50
                    )
                }

                // Vocabulary settings
                Section("Vocabulary") {
                    HStack {
                        Text("New words per article")
                        Spacer()
                        Text("\(viewModel.config.newWordsPerArticle)")
                            .foregroundStyle(.secondary)
                    }
                    Slider(
                        value: Binding(
                            get: { Double(viewModel.config.newWordsPerArticle) },
                            set: { viewModel.config.newWordsPerArticle = Int($0) }
                        ),
                        in: 5...20,
                        step: 1
                    )

                    HStack {
                        Text("Max sentence length")
                        Spacer()
                        Text("\(viewModel.config.maxSentenceLength) words")
                            .foregroundStyle(.secondary)
                    }
                    Slider(
                        value: Binding(
                            get: { Double(viewModel.config.maxSentenceLength) },
                            set: { viewModel.config.maxSentenceLength = Int($0) }
                        ),
                        in: 10...25,
                        step: 1
                    )

                    HStack {
                        Text("Vocabulary reuse ratio")
                        Spacer()
                        Text("\(Int(viewModel.config.reuseRatio * 100))%")
                            .foregroundStyle(.secondary)
                    }
                    Slider(value: $viewModel.config.reuseRatio, in: 0.3...0.9, step: 0.05)
                }

                // Quiz settings
                Section("Quiz") {
                    Stepper(
                        "Questions per quiz: \(viewModel.config.quizQuestionsCount)",
                        value: $viewModel.config.quizQuestionsCount,
                        in: 3...15
                    )
                }

                // News settings
                Section("News") {
                    Stepper(
                        "Timeframe: \(viewModel.config.newsTimeframeHours)h",
                        value: $viewModel.config.newsTimeframeHours,
                        in: 12...168,
                        step: 12
                    )
                }

                // API settings
                Section("Server") {
                    TextField("API Base URL", text: Binding(
                        get: { APIClient.shared.baseURL },
                        set: { APIClient.shared.baseURL = $0 }
                    ))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                }

                // Device ID (read-only, for debugging)
                Section {
                    HStack {
                        Text("Device ID")
                        Spacer()
                        Text(APIClient.shared.userId.prefix(8) + "...")
                            .foregroundStyle(.secondary)
                            .font(.system(.body, design: .monospaced))
                    }
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = APIClient.shared.userId
                        } label: {
                            Label("Copy Full ID", systemImage: "doc.on.doc")
                        }
                    }
                } footer: {
                    Text("Each device has a unique ID. Your articles and vocabulary are private to this device.")
                }

                // Save button
                Section {
                    Button {
                        Task { await viewModel.saveConfig() }
                    } label: {
                        HStack {
                            Spacer()
                            if viewModel.isSaving {
                                ProgressView()
                                    .padding(.trailing, 8)
                            }
                            Text("Save Settings")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(viewModel.isSaving)
                }
            }
        }
        .navigationTitle("Settings")
        .task {
            await viewModel.loadConfig()
        }
        .alert("Saved", isPresented: .init(
            get: { viewModel.savedMessage != nil },
            set: { if !$0 { viewModel.savedMessage = nil } }
        )) {
            Button("OK") { viewModel.savedMessage = nil }
        } message: {
            Text(viewModel.savedMessage ?? "")
        }
    }
}

// MARK: - Editable List Row

/// A row that displays a value and lets the user tap to edit it inline.
private struct EditableListRow: View {
    let value: String
    let onSave: (String) -> Void

    @State private var isEditing = false
    @State private var editText = ""

    var body: some View {
        if isEditing {
            HStack {
                TextField("Enter value", text: $editText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit {
                        onSave(editText)
                        isEditing = false
                    }

                Button("Done") {
                    onSave(editText)
                    isEditing = false
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.accentColor)
            }
        } else {
            Button {
                editText = value
                isEditing = true
            } label: {
                Text(value.capitalized)
                    .foregroundStyle(.primary)
            }
        }
    }
}

// MARK: - Add Item Row

/// A row with a text field and "Add" button for adding new items.
private struct AddItemRow: View {
    let placeholder: String
    let onAdd: (String) -> Void

    @State private var text = ""

    var body: some View {
        HStack {
            TextField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit {
                    guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    onAdd(text)
                    text = ""
                }

            Button {
                guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                onAdd(text)
                text = ""
            } label: {
                Image(systemName: "plus.circle.fill")
                    .foregroundStyle(Color.accentColor)
            }
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}

#Preview {
    NavigationStack {
        ConfigView()
    }
}
