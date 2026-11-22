//
//  JapaneseTutorApp.swift
//  JapaneseTutor
//
//  Created by Andreas Jakob on 2026/02/14.
//

import SwiftUI
import RevenueCat

@main
struct JapaneseTutorApp: App {

    @State private var showOnboarding: Bool =
        !UserDefaults.standard.bool(forKey: "hasCompletedOnboarding")

    init() {
        RevenueCatService.shared.configure()
    }

    @AppStorage(LearningLanguage.storageKey) private var learningLanguage = LearningLanguage.japanese.rawValue

    var body: some Scene {
        WindowGroup {
            // The learning language is chosen in Settings only (owner's decision, 2026-11-22):
            // a new install starts as the Japanese course.
            if showOnboarding {
                // the same setup steps for every language
                OnboardingFlowView {
                    withAnimation(.easeInOut(duration: 0.4)) {
                        showOnboarding = false
                    }
                }
                .id(learningLanguage)
            } else {
                ContentView()
            }
        }
    }
}

/// Lets one tab send the learner to another (the progress screen's "Read something new" opens the New Article form).
@Observable
final class TabRouter {
    static let shared = TabRouter()
    var tab = 0
    /// Set by the progress screen; the article list opens its New Article form and clears it.
    var wantsNewArticle = false
}

struct ContentView: View {
    @AppStorage(LearningLanguage.storageKey) private var learningLanguage = LearningLanguage.japanese.rawValue

    var body: some View {
        // One set of screens for every language; a fresh set when the language changes,
        // so texts (English / Japanese) and data are those of the new language.
        tabs.id(learningLanguage)
    }

    private var tabs: some View {
        TabView(selection: Bindable(TabRouter.shared).tab) {
            NavigationStack {
                ArticleFeedView()
            }
            .tabItem {
                Label(L("Articles", "記事"), systemImage: "doc.text")
            }
            .tag(0)

            NavigationStack {
                VocabularyListView()
            }
            .tabItem {
                Label(L("Vocabulary", "単語"), systemImage: "character.book.closed")
            }
            .tag(1)

            NavigationStack {
                StatsView()
            }
            .tabItem {
                Label(L("Progress", "進み具合"), systemImage: "chart.line.uptrend.xyaxis")
            }
            .tag(2)

            NavigationStack {
                ConfigView()
            }
            .tabItem {
                Label(L("Settings", "設定"), systemImage: "gear")
            }
            .tag(3)
        }
    }
}
