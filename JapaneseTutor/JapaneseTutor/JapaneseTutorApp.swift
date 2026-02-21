//
//  JapaneseTutorApp.swift
//  JapaneseTutor
//
//  Created by Andreas Jakob on 2026/02/14.
//

import SwiftUI

@main
struct JapaneseTutorApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
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
