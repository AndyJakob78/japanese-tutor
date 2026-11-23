import SwiftUI

/// "My meadow" — the sheep's story on top of the progress screen.
/// Everything comes from data the progress screen already has:
///   chapter = the learner's level (one chapter per level, the last one when the course is done),
///   sprout  = how far the learner is inside the level (seed → flower),
///   friends = badges earned (each badge brings one sheep friend).
struct MeadowCard: View {
    let progress: LearningProgress

    /// Story chapters, from lost to showing the next lost sheep the way.
    static let chapters: [(en: String, ja: String, image: String)] = [
        ("Lost in a new meadow", "新しい牧場で迷子に", "ChapterLost"),
        ("Starting to hear the herd", "群れの声が聞こえてきた", "ChapterReading"),
        ("First words with a neighbour", "となりの羊と、はじめての会話", "ChapterReading"),
        ("Grazing with the herd", "群れと一緒に草を食べる", "ChapterHappy"),
        ("Showing the next lost sheep the way", "次の迷子に道を教える", "ChapterHerd"),
    ]

    /// Which chapter a level belongs to. Courses with three levels skip the middle chapters,
    /// so every course starts lost and ends showing others the way.
    static func chapterIndex(levelIndex: Int, levelCount: Int, done: Bool) -> Int {
        if done { return chapters.count - 1 }
        guard levelCount > 1 else { return 0 }
        let spread = Double(levelIndex) / Double(levelCount - 1) * Double(chapters.count - 2)
        return min(chapters.count - 2, Int(spread.rounded()))
    }

    /// 0 seed · 1 sprout · 2 third leaf · 3 young plant · 4 bud · 5 flower (level done)
    static func sproutStage(percent: Int, done: Bool) -> Int {
        done ? 5 : min(4, max(0, percent / 20))
    }

    static let sproutNames: [(en: String, ja: String)] = [
        ("Seed", "種"), ("Sprout", "芽"), ("Third leaf", "3枚目の葉"), ("Young plant", "若木"), ("Bud", "つぼみ"), ("Flower", "花"),
    ]

    private var levels: [String] { LearningLanguage.current.levels }
    private var done: Bool { progress.estimate.done == true }
    private var chapter: Int {
        Self.chapterIndex(levelIndex: levels.firstIndex(of: progress.level) ?? 0, levelCount: levels.count, done: done)
    }
    private var stage: Int { Self.sproutStage(percent: progress.progress.percent, done: done) }
    private var friends: Int { progress.badges.filter { $0.earnedAt != nil }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Chapter scene
            ZStack(alignment: .bottomLeading) {
                Color.clear
                    .frame(height: 190)
                    .frame(maxWidth: .infinity)
                    .overlay(
                        Image(Self.chapters[chapter].image)
                            .resizable()
                            .scaledToFill()
                            .offset(y: 18)   // show the sheep, not the sky
                    )
                    .clipped()
                LinearGradient(colors: [.clear, Color.meadowNavy.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Chapter \(chapter + 1)", "第\(chapter + 1)章"))
                        .font(.caption.weight(.semibold))
                    Text(L(Self.chapters[chapter].en, Self.chapters[chapter].ja))
                        .font(.system(.headline, design: .rounded))
                }
                .foregroundStyle(.white)
                .padding(12)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18))

            // Sprout
            VStack(alignment: .leading, spacing: 8) {
                Text(L("Your sprout", "芽の成長"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                HStack(spacing: 0) {
                    ForEach(0..<6, id: \.self) { i in
                        VStack(spacing: 4) {
                            Image("Sprout\(i)")
                                .resizable()
                                .scaledToFill()
                                .frame(width: i == stage ? 46 : 34, height: i == stage ? 46 : 34)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(i == stage ? Color.meadowLeaf : .clear, lineWidth: 2.5))
                                .opacity(i <= stage ? 1 : 0.35)
                            Text(L(Self.sproutNames[i].en, Self.sproutNames[i].ja))
                                .font(.system(size: 9, weight: i == stage ? .bold : .regular))
                                .foregroundStyle(i == stage ? Color.meadowLeaf : .secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 66, alignment: .bottom)
                Text(L("\(progress.progress.known) of \(progress.progress.total) \(progress.level) words",
                       "\(progress.level) の単語 \(progress.progress.total)語中 \(progress.progress.known)語"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

extension Color {
    /// Kotonome palette (icon and store pages)
    static let meadowNavy = Color(red: 0x1F / 255, green: 0x2A / 255, blue: 0x5C / 255)
    static let meadowLeaf = Color(red: 0x5E / 255, green: 0x9A / 255, blue: 0x4C / 255)
}
