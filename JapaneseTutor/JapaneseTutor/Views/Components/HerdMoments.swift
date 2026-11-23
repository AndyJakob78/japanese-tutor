import SwiftUI

/// Remembers which chapter and how many herd friends the learner has already seen,
/// so a NEW friend or chapter can be celebrated once (after a quiz).
enum HerdMemory {
    private static var lang: String { LearningLanguage.current.rawValue }
    private static var friendsKey: String { "herdFriendsSeen_\(lang)" }
    private static var chapterKey: String { "herdChapterSeen_\(lang)" }

    struct Moment {
        var newFriend = false
        var newChapter: Int?
        var isEmpty: Bool { !newFriend && newChapter == nil }
    }

    static func friends(_ p: LearningProgress) -> Int { p.badges.filter { $0.earnedAt != nil }.count }
    static func chapter(_ p: LearningProgress) -> Int {
        let levels = LearningLanguage.current.levels
        return MeadowCard.chapterIndex(levelIndex: levels.firstIndex(of: p.level) ?? 0,
                                       levelCount: levels.count, done: p.estimate.done == true)
    }

    /// The first time, only remembers (old badges are not "new").
    static func rememberIfFirst(_ p: LearningProgress) {
        let d = UserDefaults.standard
        if d.object(forKey: friendsKey) == nil { d.set(friends(p), forKey: friendsKey) }
        if d.object(forKey: chapterKey) == nil { d.set(chapter(p), forKey: chapterKey) }
    }

    /// What is new since last time, and remember it.
    static func takeNew(_ p: LearningProgress) -> Moment {
        let d = UserDefaults.standard
        guard d.object(forKey: friendsKey) != nil else { rememberIfFirst(p); return Moment() }
        var m = Moment()
        let f = friends(p), c = chapter(p)
        if f > d.integer(forKey: friendsKey) { m.newFriend = true }
        if c > d.integer(forKey: chapterKey) { m.newChapter = c }
        d.set(f, forKey: friendsKey)
        d.set(c, forKey: chapterKey)
        return m
    }
}

/// Invite link and text for sharing.
enum ShareText {
    static let appURL = URL(string: "https://apps.apple.com/app/id6759218949")!

    static func message(code: String?) -> String {
        let invite = code.map { L(" Use my invite code \($0) — we both get a free article.", "招待コード \($0) を使うと、2人とも無料の記事が1つもらえます。") } ?? ""
        return L("I'm learning Japanese with real news on Kotonome 🐑", "ことのめで、ニュースを読みながら\(LearningLanguage.current == .german ? "ドイツ語" : "英語")を勉強しています🐑") + invite
    }
}

/// The picture that gets shared (Instagram story, LINE, X …). Square, works everywhere.
struct ShareCardView: View {
    let imageName: String
    let headline: String
    let detail: String
    let code: String?

    var body: some View {
        VStack(spacing: 0) {
            Image(imageName)
                .resizable()
                .scaledToFill()
                .frame(width: 540, height: 400)
                .clipped()
            VStack(alignment: .leading, spacing: 10) {
                Text(headline)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.meadowNavy)
                Text(detail)
                    .font(.system(size: 22))
                    .foregroundStyle(Color.meadowNavy.opacity(0.75))
                Spacer(minLength: 0)
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Kotonome  ことのめ")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(red: 0.91, green: 0.44, blue: 0.29))
                        Text(L("Learn with real news", "ニュースで学ぶ"))
                            .font(.system(size: 16))
                            .foregroundStyle(Color.meadowNavy.opacity(0.6))
                    }
                    Spacer()
                    if let code {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(L("Invite code", "招待コード"))
                                .font(.system(size: 14))
                                .foregroundStyle(Color.meadowNavy.opacity(0.6))
                            Text(code)
                                .font(.system(size: 26, weight: .bold, design: .monospaced))
                                .foregroundStyle(Color.meadowNavy)
                        }
                    }
                }
            }
            .padding(28)
            .frame(width: 540, height: 280, alignment: .topLeading)
            .background(Color(red: 0.97, green: 0.95, blue: 0.91))
        }
        .frame(width: 540, height: 680)
    }

    @MainActor
    func render() -> Image? {
        let renderer = ImageRenderer(content: self)
        renderer.scale = 2
        return renderer.uiImage.map { Image(uiImage: $0) }
    }
}

/// "A new friend joined your herd" / "New chapter" card with a share button.
struct HerdMomentCard: View {
    let moment: HerdMemory.Moment
    let progress: LearningProgress
    @State private var code: String?
    @State private var shareImage: Image?

    private var chapterInfo: (en: String, ja: String, image: String)? {
        moment.newChapter.map { MeadowCard.chapters[$0] }
    }

    private var headline: String {
        if let c = moment.newChapter, let info = chapterInfo {
            return L("Chapter \(c + 1): \(info.en)", "第\(c + 1)章：\(info.ja)")
        }
        return L("A new friend joined your herd!", "群れに新しい仲間が加わりました！")
    }

    private var detail: String {
        L("\(HerdMemory.friends(progress)) friends · \(progress.progress.known) \(progress.level) words",
          "仲間 \(HerdMemory.friends(progress))匹 ・ \(progress.level)の単語 \(progress.progress.known)語")
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(chapterInfo?.image ?? "ChapterHerd")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 4) {
                    Text(headline)
                        .font(.headline)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            if let shareImage {
                ShareLink(item: shareImage,
                          subject: Text("Kotonome"),
                          message: Text(ShareText.message(code: code) + "\n" + ShareText.appURL.absoluteString),
                          preview: SharePreview(headline, image: shareImage)) {
                    Label(L("Share with a friend", "友だちにシェア"), systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                }
            }
            if code != nil {
                Text(L("Your friend enters your code in setup — you both get 1 free article.", "友だちが設定でコードを入力すると、2人とも無料の記事が1つもらえます。"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(16)
        .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 18))
        .task {
            code = try? await APIClient.shared.fetchReferralCode()
            shareImage = ShareCardView(imageName: chapterInfo?.image ?? "ChapterHerd", headline: headline, detail: detail, code: code).render()
        }
    }
}

/// The sheep at the top of every result screen (article quiz, word quiz, daily review, sentence practice).
/// perfect → happy sheep "Mē~!", good (≥70 %) → reading sheep "Well done!", else → reading sheep "Good try".
struct SheepResult: View {
    let perfect: Bool
    let good: Bool
    var perfectText = L("Mē~! All correct!", "めぇ〜！全問正解！")

    var body: some View {
        VStack(spacing: 14) {
            // cut-out sheep (no photo background), so it sits on cream and on dark navy alike
            Image(perfect ? "CornerCheer" : good ? "CornerWave" : "CornerComfort")
                .resizable()
                .scaledToFit()
                .frame(height: perfect ? 190 : 150)
            Text(perfect ? perfectText
                 : good ? L("Well done!", "よくできました！")
                 : L("Good try — keep going!", "おしい！この調子で続けましょう"))
                .font(.title.weight(.bold))
                .multilineTextAlignment(.center)
        }
    }
}
