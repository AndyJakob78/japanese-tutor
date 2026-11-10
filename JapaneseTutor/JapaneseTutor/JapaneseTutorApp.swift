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

    var body: some Scene {
        WindowGroup {
            if showOnboarding {
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
    var body: some View {
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
