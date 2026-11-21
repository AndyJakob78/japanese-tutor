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
    @AppStorage("hasChosenLearningLanguage") private var hasChosenLanguage = false

    var body: some Scene {
        WindowGroup {
            if showOnboarding && !hasChosenLanguage {
                // New installs first choose what to learn (1.5)
                LangOnboardingView { finished in
                    hasChosenLanguage = true
                    if finished {   // German / English: their short setup is done
                        UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
                        withAnimation(.easeInOut(duration: 0.4)) { showOnboarding = false }
                    }
                }
            } else if showOnboarding {
                OnboardingFlowView {
                    withAnimation(.easeInOut(duration: 0.4)) {
                        showOnboarding = false
                    }
                }
            } else {
                ContentView()
            }
        }
    }
}

struct ContentView: View {
    @AppStorage(LearningLanguage.storageKey) private var learningLanguage = LearningLanguage.japanese.rawValue

    var body: some View {
        if learningLanguage == LearningLanguage.japanese.rawValue {
            japaneseTabs
        } else {
            // German / English: own screens, Japanese interface
            LangRootView()
                .id(learningLanguage) // a fresh screen set when the language changes
        }
    }

    private var japaneseTabs: some View {
        TabView {
            NavigationStack {
                ArticleFeedView()
            }
            .tabItem {
                Label("Articles", systemImage: "doc.text")
            }

            NavigationStack {
                VocabularyListView()
            }
            .tabItem {
                Label("Vocabulary", systemImage: "character.book.closed")
            }

            NavigationStack {
                StatsView()
            }
            .tabItem {
                Label("Stats", systemImage: "chart.bar")
            }

            NavigationStack {
                ConfigView()
            }
            .tabItem {
                Label("Settings", systemImage: "gear")
            }
        }
    }
}
