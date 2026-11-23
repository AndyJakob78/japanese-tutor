import SwiftUI

@Observable
class ConfigViewModel {
    var config: AppConfig = .default
    var isLoading = false
    var isSaving = false
    var errorMessage: String?
    var savedMessage: String?

    let levels = LearningLanguage.current.levels

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
            savedMessage = L("Settings saved", "設定を保存しました")
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
                    ProgressView(L("Loading settings...", "設定を読み込んでいます…"))
                }
            } else {
                // Learning language (German / English have their own screens)
                Section {
                    LearningLanguagePicker(title: L("Learning language", "学習する言語"))
                } footer: {
                    Text(L("German and English are for Japanese speakers; their screens are in Japanese. Each language keeps its own articles, words and settings.", "言語ごとに、記事・単語・設定は別々に保存されます。"))
                }

                // Writing System — Japanese only (German and English have one script)
                if LearningLanguage.current.isJapanese {
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
                }

                // Level (JLPT for Japanese, A1–B2 for German / English)
                Section(L("Proficiency Level", "レベル")) {
                    Picker(L("JLPT Level", "レベル"), selection: $viewModel.config.proficiencyLevel) {
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
                            display: Labels.topic,
                            onSave: { newValue in
                                viewModel.updateTopic(at: index, with: newValue)
                            }
                        )
                    }
                    .onDelete { offsets in
                        viewModel.deleteTopic(at: offsets)
                    }

                    if viewModel.config.topics.count < 10 {
                        // One-tap suggestions (the same topics as in setup)
                        let missing = OnboardingViewModel.topicChoices.filter { !viewModel.config.topics.contains($0) }
                        if !missing.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(missing, id: \.self) { topic in
                                        Button {
                                            viewModel.addTopic(topic)
                                        } label: {
                                            Label(Labels.topic(topic), systemImage: "plus")
                                                .font(.subheadline)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 6)
                                                .background(Color.accentColor.opacity(0.12), in: Capsule())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                        AddItemRow(placeholder: L("Your own topic, e.g. ramen, baseball…", "自分のテーマ　例: ラーメン、野球…")) { newTopic in
                            viewModel.addTopic(newTopic)
                        }
                    }
                } header: {
                    Text(L("Topics of Interest", "興味のあるテーマ"))
                } footer: {
                    Text(L("\(viewModel.config.topics.count)/10 topics. Swipe to delete, tap to edit.", "\(viewModel.config.topics.count)/10 テーマ。スワイプで削除、タップで編集。"))
                }

                // Regions — editable list
                Section {
                    ForEach(Array(viewModel.config.regions.enumerated()), id: \.offset) { index, region in
                        EditableListRow(
                            value: region,
                            display: Labels.region,
                            onSave: { newValue in
                                viewModel.updateRegion(at: index, with: newValue)
                            }
                        )
                    }
                    .onDelete { offsets in
                        viewModel.deleteRegion(at: offsets)
                    }

                    if viewModel.config.regions.count < 10 {
                        AddItemRow(placeholder: L("e.g. Tokyo, Bavaria, California...", "例: 東京、バイエルン、カリフォルニア…")) { newRegion in
                            viewModel.addRegion(newRegion)
                        }
                    }
                } header: {
                    Text(L("Regions", "地域"))
                } footer: {
                    Text(L("\(viewModel.config.regions.count)/10 regions. Can be a country, state, prefecture, or city.", "\(viewModel.config.regions.count)/10 地域。国、州、都道府県、都市を指定できます。"))
                }

                // Article settings
                Section(L("Article", "記事")) {
                    Stepper(
                        L("Article length: \(viewModel.config.targetWordCount) words", "記事の長さ: \(viewModel.config.targetWordCount)語"),
                        value: $viewModel.config.targetWordCount,
                        in: 100...500,
                        step: 50
                    )
                }

                // Vocabulary settings
                Section(L("Vocabulary", "単語")) {
                    HStack {
                        Text(L("New words per article", "1記事あたりの新しい単語"))
                        Spacer()
                        Text("\(viewModel.config.newWordsPerArticle)")
                            .foregroundStyle(.secondary)
                    }
                    Slider(
                        value: Binding(
                            get: { Double(viewModel.config.newWordsPerArticle) },
                            set: { viewModel.config.newWordsPerArticle = Int($0) }
                        ),
                        in: 0...20,
                        step: 1
                    )
                    Text(viewModel.config.newWordsPerArticle == 0
                         ? L("0 = no new words. Articles use only words you have met before, with more review words.", "0 = 新しい単語なし。これまでに出会った単語だけで記事を書き、復習の単語を増やします。")
                         : L("Fewer new words means more review words from your earlier articles.", "新しい単語を減らすと、以前の記事の単語を復習する機会が増えます。"))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack {
                        Text(L("Max sentence length", "1文の長さ (最大)"))
                        Spacer()
                        Text(L("\(viewModel.config.maxSentenceLength) words", "\(viewModel.config.maxSentenceLength)語"))
                            .foregroundStyle(.secondary)
                    }
                    Slider(
                        value: Binding(
                            get: { Double(viewModel.config.maxSentenceLength) },
                            set: { viewModel.config.maxSentenceLength = Int($0) }
                        ),
                        in: LearningLanguage.current.isJapanese ? 10...25 : 8...30,
                        step: 1
                    )

                    HStack {
                        Text(L("Vocabulary reuse ratio", "単語を再利用する割合"))
                        Spacer()
                        Text("\(Int(viewModel.config.reuseRatio * 100))%")
                            .foregroundStyle(.secondary)
                    }
                    Slider(value: $viewModel.config.reuseRatio, in: 0.3...0.9, step: 0.05)
                }

                // Quiz settings
                Section(L("Quiz", "クイズ")) {
                    Stepper(
                        L("Questions per quiz: \(viewModel.config.quizQuestionsCount)", "クイズの問題数: \(viewModel.config.quizQuestionsCount)"),
                        value: $viewModel.config.quizQuestionsCount,
                        in: 3...15
                    )
                }

                // News settings
                Section(L("News", "ニュース")) {
                    Stepper(
                        L("Timeframe: \(viewModel.config.newsTimeframeHours)h", "ニュースの期間: \(viewModel.config.newsTimeframeHours)時間"),
                        value: $viewModel.config.newsTimeframeHours,
                        in: 12...168,
                        step: 12
                    )
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
                            } else if viewModel.savedMessage != nil {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            }
                            Text(viewModel.savedMessage != nil ? L("Saved", "保存しました") : L("Save Settings", "設定を保存"))
                                .fontWeight(.semibold)
                                .contentTransition(.opacity)
                            Spacer()
                        }
                    }
                    .disabled(viewModel.isSaving)
                }
            }
        }
        .navigationTitle(L("Settings", "設定"))
        .kotonomeScreen()
        .task {
            await viewModel.loadConfig()
        }
        // Saved: the button shows a tick and a sheep note pops up for a moment; you stay here
        .overlay(alignment: .bottom) {
            if viewModel.savedMessage != nil {
                HStack(spacing: 10) {
                    Image("CornerCheer").resizable().scaledToFit().frame(width: 40, height: 50)
                    Text(L("Saved. Your next article uses these settings.", "保存しました。次の記事からこの設定を使います。"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.meadowNavy)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(red: 1, green: 0.992, blue: 0.973), in: Capsule())
                .overlay(Capsule().stroke(Color.accentColor.opacity(0.6), lineWidth: 1.5))
                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                .padding(.bottom, 90)
                .padding(.horizontal, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task {
                    try? await Task.sleep(for: .seconds(2.5))
                    withAnimation { viewModel.savedMessage = nil }
                }
            }
        }
        .animation(.spring(response: 0.35), value: viewModel.savedMessage)
        // a failed save used to look like "nothing happened"
        .alert(L("Not saved", "保存できませんでした"), isPresented: .init(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(L("Please check your connection and try again.", "通信を確認して、もう一度お試しください。"))
        }
    }
}

// MARK: - Editable List Row

/// A row that displays a value and lets the user tap to edit it inline.
private struct EditableListRow: View {
    let value: String
    /// How the stored value is shown (topics and regions get Japanese names on the German / English screens)
    var display: (String) -> String = { $0.capitalized }
    let onSave: (String) -> Void

    @State private var isEditing = false
    @State private var editText = ""

    var body: some View {
        if isEditing {
            HStack {
                TextField(L("Enter value", "入力してください"), text: $editText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit {
                        onSave(editText)
                        isEditing = false
                    }

                Button(L("Done", "完了")) {
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
                Text(display(value))
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
