import SwiftUI

// MARK: - Progress screen (2026-11-22)
// Answers three questions in this order: how long until my next level, what
// should I do now, am I keeping it up. All numbers and the choice of the next
// step come from GET /api/progress; the rules are written out in
// PROGRESS_SCREEN.md. This file only draws them and opens the right exercise.

private extension Color {
    static let pathIndigo = Color(red: 0.20, green: 0.23, blue: 0.49)
    static let kaki = Color(red: 0.94, green: 0.46, blue: 0.18)
    static let leaf = Color(red: 0.18, green: 0.62, blue: 0.43)
}

@Observable
class ProgressViewModel {
    var progress: LearningProgress?
    var isLoading = false
    var failed = false
    /// Which pace the headline shows: nil = the learner's own pace, otherwise a scenario key
    var pace: String?

    func load() async {
        isLoading = progress == nil
        do {
            let fresh = try await APIClient.shared.fetchProgress()
            progress = fresh
            failed = false
            // Without an own estimate the headline shows what daily review would give
            if !fresh.estimate.available, pace == nil || !fresh.scenarios.contains(where: { $0.key == pace }) {
                pace = fresh.scenarios.first?.key
            }
        } catch {
            failed = progress == nil
        }
        isLoading = false
    }
}

struct StatsView: View {
    @State private var viewModel = ProgressViewModel()
    @State private var showReview = false
    @State private var openArticle: Int?
    @State private var openQuiz: Int?
    @State private var openSentences: Int?

    var body: some View {
        ScrollView {
            if let p = viewModel.progress {
                VStack(alignment: .leading, spacing: 18) {
                    MeadowCard(progress: p)
                    .onAppear { HerdMemory.rememberIfFirst(p) }
                    headline(p)
                    paceButtons(p)
                    levelPath(p)
                    nextStep(p)
                    streakBlock(p.streak)
                    if let gain = p.weekGain { weekGain(gain, p) }
                    goalsBlock(p.goals)
                    if let spot = p.weakSpot { weakSpot(spot) }
                    herdBlock(p)
                    NavigationLink(destination: StatsDetailsView()) {
                        HStack {
                            Text(L("All numbers", "くわしい数字"))
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                        .padding(.vertical, 6)
                    }
                }
                .padding()
            } else if viewModel.failed {
                ContentUnavailableView(L("Not loaded", "読み込めません"), systemImage: "wifi.exclamationmark",
                                       description: Text(L("Pull down to try again.", "下に引いてもう一度お試しください。")))
                    .padding(.top, 80)
            } else {
                ProgressView().padding(.top, 120)
            }
        }
        .navigationTitle(L("My meadow", "わたしの牧場"))
        .kotonomeScreen()
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
        .fullScreenCover(isPresented: $showReview, onDismiss: { Task { await viewModel.load() } }) {
            NavigationStack { TypedReviewView() }
        }
        .navigationDestination(item: $openArticle) { ArticleDetailView(articleId: $0) }
        .navigationDestination(item: $openQuiz) { QuizView(articleId: $0) }
        .navigationDestination(item: $openSentences) { SentencePracticeLoader(articleId: $0) }
    }

    // MARK: 1. Time to the next level

    private var isJapaneseUI: Bool { !LearningLanguage.current.isJapanese }

    /// The estimate the headline shows: the learner's own, or the chosen pace button's.
    private func shown(_ p: LearningProgress) -> (value: Int?, unit: String, date: String?)? {
        if let key = viewModel.pace, let s = p.scenarios.first(where: { $0.key == key }) { return (s.value, s.unit, s.date) }
        guard p.estimate.available, let unit = p.estimate.unit else { return nil }
        return (p.estimate.value, unit, p.estimate.date)
    }

    @ViewBuilder
    private func headline(_ p: LearningProgress) -> some View {
        let goal = p.nextLevel ?? p.level
        VStack(alignment: .leading, spacing: 4) {
            if p.estimate.done == true {
                Text(L("\(p.level) complete", "\(p.level) 達成"))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                Text(L("Raise your level in Settings to keep going.", "設定でレベルを上げて、次に進みましょう。"))
                    .foregroundStyle(.secondary)
            } else if let e = shown(p) {
                if !p.estimate.available {
                    Text(L("Not enough of your own data yet. With regular use:", "まだデータが足りません。続けた場合の目安:"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let value = e.value {
                        Text("\(value)")
                            .font(.system(size: 68, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text(unitName(e.unit, value))
                            .font(.system(size: 26, weight: .semibold, design: .rounded))
                    } else {
                        Text(L("Over 2 years", "2年以上"))
                            .font(.system(size: 40, weight: .bold, design: .rounded))
                    }
                }
                (Text(p.nextLevel == nil ? L("to complete ", "") : L("to ", ""))
                    + Text(goal).foregroundStyle(Color.kaki).fontWeight(.semibold)
                    + Text(p.nextLevel == nil ? L("", " の達成まで") : L("", " まで"))
                    + Text(e.date.map { L(", around \(monthName($0))", "　\(monthName($0))ごろ") } ?? ""))
                    .font(.system(size: 19, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            } else {
                Text(L("Review on \(p.estimate.needDays ?? 1) more days to see your estimate", "あと\(p.estimate.needDays ?? 1)日復習すると、目安が表示されます"))
                    .font(.system(size: 26, weight: .bold, design: .rounded))
            }
            Text(L("\(p.progress.known) of \(p.progress.total) \(p.level) words known · vocabulary only", "\(p.level) の単語 \(p.progress.total)語中 \(p.progress.known)語 · 単語のみの目安"))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func paceButtons(_ p: LearningProgress) -> some View {
        let options: [(key: String?, label: String)] =
            (p.estimate.available && p.estimate.done != true ? [(nil, L("As now", "今のペース"))] : [])
            + p.scenarios.map { ($0.key, $0.key == "daily" ? L("Daily review", "毎日復習") : L("+1 article a day", "毎日+1記事")) }
        if options.count > 1 {
            HStack(spacing: 4) {
                ForEach(options, id: \.label) { option in
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { viewModel.pace = option.key }
                    } label: {
                        Text(option.label)
                            .font(.footnote.weight(viewModel.pace == option.key ? .semibold : .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(viewModel.pace == option.key ? Color(.systemBackground) : .clear, in: RoundedRectangle(cornerRadius: 9))
                            .foregroundStyle(viewModel.pace == option.key ? Color.primary : Color.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(3)
            .background(Color(.systemGray5), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    /// The track through all levels with the learner's place on it.
    private func levelPath(_ p: LearningProgress) -> some View {
        let levels = LearningLanguage.current.levels
        let at = Double(levels.firstIndex(of: p.level) ?? 0)
        let place = (at + Double(p.progress.percent) / 100) / Double(levels.count)
        return VStack(spacing: 8) {
            GeometryReader { geo in
                let x = max(9, min(geo.size.width - 9, geo.size.width * place))
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.systemGray5)).frame(height: 8)
                    Capsule().fill(Color.pathIndigo).frame(width: x, height: 8)
                }
                .frame(width: geo.size.width, height: 18)
                .overlay {
                    Circle()
                        .fill(Color(.systemBackground))
                        .overlay(Circle().stroke(Color.pathIndigo, lineWidth: 4))
                        .frame(width: 18, height: 18)
                        .position(x: x, y: 9)
                    Text(L("You are here", "現在地"))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color(.systemBackground))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Color.primary, in: RoundedRectangle(cornerRadius: 7))
                        .fixedSize()
                        .position(x: max(42, min(geo.size.width - 42, x)), y: -15)
                }
            }
            .frame(height: 18)
            .padding(.top, 26)
            HStack(spacing: 0) {
                ForEach(levels, id: \.self) { level in
                    Text(level)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(level == p.nextLevel ? Color.kaki : (levels.firstIndex(of: level) ?? 0) <= Int(at) ? Color.primary : Color.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // MARK: 2. Do this next

    private func nextStep(_ p: LearningProgress) -> some View {
        let action = p.nextAction
        return VStack(alignment: .leading, spacing: 10) {
            Text(L("Do this next", "次にすること"))
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .kerning(0.6)
                .opacity(0.85)
            Text(actionTitle(action))
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .fixedSize(horizontal: false, vertical: true)
            Text(actionReason(action, p))
                .font(.subheadline)
                .opacity(0.92)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                perform(action)
            } label: {
                Text(actionButton(action))
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(Color(red: 0.60, green: 0.25, blue: 0.05))
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(.white)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.kaki, in: RoundedRectangle(cornerRadius: 22))
    }

    private func actionTitle(_ a: LearningProgress.NextAction) -> String {
        let n = a.count ?? 0, m = a.minutes ?? 3
        switch a.kind {
        case "welcome_back": return L("Welcome back. Start with \(n) easy words · \(m) min", "おかえりなさい。やさしい\(n)語から · \(m)分")
        case "review": return L("Review \(n) words · \(m) min", "\(n)語を復習 · \(m)分")
        case "read": return L("Read your new article · \(m) min", "新しい記事を読む · \(m)分")
        case "quiz": return L("Take the quiz · \(m) min", "クイズに挑戦 · \(m)分")
        case "practise": return L("Practise \(a.pattern ?? "") · \(n) sentences", "\(a.pattern ?? "") を練習 · \(n)文")
        case "type": return L("Type \(n) words from memory · \(m) min", "\(n)語を思い出して入力 · \(m)分")
        case "goal": return L("Finish this week's goal: \(n) to go", "今週の目標まであと\(n)")
        default: return L("Read something new", "新しい記事を読みましょう")
        }
    }

    private func actionReason(_ a: LearningProgress.NextAction, _ p: LearningProgress) -> String {
        var parts: [String] = []
        if let days = a.reason.daysCloser {
            let goal = p.nextLevel ?? p.level
            parts.append(L("Brings \(goal) about \(days) day\(days == 1 ? "" : "s") closer.", "\(goal) に約\(days)日近づきます。"))
        }
        if let streak = a.reason.streak { parts.append(L("Keeps your \(streak)-day streak.", "\(streak)日連続を守れます。")) }
        if a.reason.goal == true { parts.append(L("Completes this week's goal.", "今週の目標を達成できます。")) }
        if !parts.isEmpty { return parts.joined(separator: " ") }
        switch a.kind {
        case "welcome_back": return L("A short start is enough to get going again.", "短い復習から、また始めましょう。")
        case "review": return L("They are due today.", "今日が復習の日です。")
        case "read": return L("It is ready and waiting for you.", "記事ができています。")
        case "quiz": return L("You read the article. Check what stayed.", "読んだ記事の内容を確かめましょう。")
        case "practise": return L("This slip keeps coming back in your own sentences.", "自分で書いた文で、同じ間違いが続いています。")
        case "type": return L("Only typed words can become Known.", "入力して正解した単語だけが「覚えた」になります。")
        default: return L("You are up to date. Time for new words.", "復習は終わっています。新しい単語に進みましょう。")
        }
    }

    private func actionButton(_ a: LearningProgress.NextAction) -> String {
        switch a.kind {
        case "welcome_back", "review", "type": return L("Start review", "復習をはじめる")
        case "read": return L("Open article", "記事を開く")
        case "quiz": return L("Start quiz", "クイズをはじめる")
        case "practise": return L("Write sentences", "文を書く")
        case "goal": return a.goal == "articles" ? L("New article", "新しい記事") : a.goal == "sentences" ? L("Write sentences", "文を書く") : L("Start review", "復習をはじめる")
        default: return L("New article", "新しい記事")
        }
    }

    private func perform(_ a: LearningProgress.NextAction) {
        switch a.kind {
        case "welcome_back", "review", "type": showReview = true
        case "read": openArticle = a.articleId
        case "quiz": openQuiz = a.articleId
        case "practise": openSentences = a.articleId
        case "goal":
            if a.goal == "sentences", let id = a.articleId { openSentences = id }
            else if a.goal == "typed" { showReview = true }
            else { newArticle() }
        default: newArticle()
        }
    }

    private func newArticle() {
        TabRouter.shared.wantsNewArticle = true
        TabRouter.shared.tab = 0
    }

    // MARK: 4. Streak

    private func streakBlock(_ s: LearningProgress.Streak) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(s.current > 0 ? Color.kaki : Color(.systemGray3))
                    .frame(width: 46, height: 46)
                    .background((s.current > 0 ? Color.kaki : Color(.systemGray3)).opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("\(s.current)-day streak", "\(s.current)日連続"))
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                    Text(streakHint(s))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 0) {
                ForEach(Array(s.week.enumerated()), id: \.element.id) { index, day in
                    VStack(spacing: 5) {
                        ZStack {
                            if day.done {
                                Circle().fill(Color.leaf)
                                Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            } else if day.today {
                                Circle().strokeBorder(Color.kaki, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
                            } else {
                                Circle().fill(Color(.systemGray5))
                            }
                        }
                        .frame(width: 30, height: 30)
                        Text(day.today ? L("Today", "今日") : weekdayName(index))
                            .font(.caption.weight(day.today ? .semibold : .medium))
                            .foregroundStyle(day.today ? Color.kaki : Color.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .card()
    }

    private func streakHint(_ s: LearningProgress.Streak) -> String {
        if s.current == 0 { return L("One exercise today starts a new streak.", "今日ひとつ学習すると、連続が始まります。") }
        if let next = s.nextBadge { return L("\(next.toGo) more day\(next.toGo == 1 ? "" : "s") for the \(next.days)-day badge", "あと\(next.toGo)日で\(next.days)日連続バッジ") }
        return L("Your best: \(s.best) days", "最長 \(s.best)日")
    }

    private func weekdayName(_ index: Int) -> String {
        (isJapaneseUI ? ["月", "火", "水", "木", "金", "土", "日"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])[index % 7]
    }

    // MARK: 5. This week's gain

    private func weekGain(_ gain: LearningProgress.WeekGain, _ p: LearningProgress) -> some View {
        let goal = p.nextLevel ?? p.level
        let good = gain.days > 0
        return Text(good
                    ? L("This week you pulled \(goal) \(gain.days) day\(gain.days == 1 ? "" : "s") closer.", "今週は \(goal) に\(gain.days)日近づきました。")
                    : gain.days == 0
                        ? L("\(goal) is as far away as on Monday. One review today moves it.", "\(goal) までの日数は月曜日と同じです。今日の復習で近づけましょう。")
                        : L("\(goal) moved \(-gain.days) day\(gain.days == -1 ? "" : "s") away. One review today turns that around.", "\(goal) が\(-gain.days)日遠くなりました。今日の復習で取り戻せます。"))
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(good ? Color.leaf : Color.kaki)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background((good ? Color.leaf : Color.kaki).opacity(0.13), in: RoundedRectangle(cornerRadius: 18))
    }

    // MARK: 6. Weekly goals

    private func goalsBlock(_ goals: [LearningProgress.Goal]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                sectionLabel(L("This week's goals", "今週の目標"))
                Spacer()
                Text(L("resets Monday", "月曜日にリセット")).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(goals) { goal in
                let done = goal.done >= goal.target
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(goalName(goal))
                        Spacer()
                        Text("\(min(goal.done, goal.target)) / \(goal.target)").fontWeight(.semibold).monospacedDigit()
                    }
                    .font(.subheadline)
                    ProgressView(value: Double(min(goal.done, goal.target)), total: Double(max(goal.target, 1)))
                        .tint(done ? Color.leaf : Color.kaki)
                        .scaleEffect(x: 1, y: 1.8, anchor: .center)
                    Text(done ? L("Done", "達成") : L("\(goal.target - goal.done) to go", "あと\(goal.target - goal.done)"))
                        .font(.caption.weight(done ? .semibold : .regular))
                        .foregroundStyle(done ? Color.leaf : Color.secondary)
                }
            }
        }
        .card()
    }

    private func goalName(_ goal: LearningProgress.Goal) -> String {
        switch goal.key {
        case "articles": return L("Read \(goal.target) articles", "記事を\(goal.target)本読む")
        case "typed": return L("Type \(goal.target) words from memory", "\(goal.target)語を思い出して入力")
        default: return L("Write \(goal.target) sentences", "文を\(goal.target)つ書く")
        }
    }

    // MARK: 3. Weak spot

    private func weakSpot(_ spot: LearningProgress.WeakSpot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel(L("Your weak spot", "苦手なところ"))
            Text(spot.pattern)
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .fixedSize(horizontal: false, vertical: true)
            Text(L("This came up \(spot.count) times in your own sentences.", "自分で書いた文で\(spot.count)回ありました。"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let example = spot.example {
                HStack(alignment: .top, spacing: 8) {
                    Text(example.wrote).foregroundStyle(.red)
                    Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary).padding(.top, 3)
                    Text(example.correct).foregroundStyle(Color.leaf).fontWeight(.semibold)
                }
                .font(.subheadline)
            }
            if let id = spot.articleId {
                Button { openSentences = id } label: {
                    Text(L("Practise it in your own sentences", "文を書いて練習する"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.kaki)
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
        }
        .card()
    }

    // MARK: 7. Your herd — every badge is a sheep friend; the closest one is the next goal

    private struct HerdItem: Identifiable {
        let badge: LearningProgress.Badge
        let current: Int, target: Int
        var id: String { badge.key }
        var earned: Bool { badge.earnedAt != nil }
        var share: Double { target > 0 ? min(1, Double(current) / Double(target)) : 0 }
        var toGo: Int { max(0, target - current) }
    }

    private static let friendPoses = ["CornerWave", "CornerCheer", "CornerCross", "CornerPeek", "CornerComfort", "CornerLookDown"]

    private func herdItems(_ p: LearningProgress) -> [HerdItem] {
        p.badges.compactMap { b in
            let target = Int(b.value.text) ?? 0
            switch b.group {
            case "articles": return HerdItem(badge: b, current: p.totals.articlesRead ?? 0, target: target)
            case "typed": return HerdItem(badge: b, current: p.totals.typedRight ?? 0, target: target)
            case "streak": return HerdItem(badge: b, current: p.streak.current, target: target)
            default: // level badges: only the learner's current level has a count to show
                if b.earnedAt != nil { return HerdItem(badge: b, current: 1, target: 1) }
                guard b.value.text == p.level else { return nil }
                return HerdItem(badge: b, current: p.progress.known, target: p.progress.total)
            }
        }
    }

    private func herdBlock(_ p: LearningProgress) -> some View {
        let items = herdItems(p)
        let earned = items.filter(\.earned)
        // per group only the nearest locked friend, closest first
        let locked = Dictionary(grouping: items.filter { !$0.earned }, by: { $0.badge.group })
            .compactMap { $0.value.min { $0.target < $1.target } }
            .sorted { $0.share > $1.share }
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                sectionLabel(L("Your herd", "あなたの群れ"))
                Spacer()
                Text(L("\(earned.count) friend\(earned.count == 1 ? "" : "s")", "仲間 \(earned.count)匹")).font(.caption).foregroundStyle(.secondary)
            }
            if let next = locked.first { nextFriend(next) }
            // the herd: friends you have, then the ones still waiting (with how far you are)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(Array(earned.enumerated()), id: \.element.id) { i, item in
                        friend(item, pose: Self.friendPoses[i % Self.friendPoses.count])
                    }
                    ForEach(Array(locked.dropFirst().enumerated()), id: \.element.id) { i, item in
                        friend(item, pose: Self.friendPoses[(earned.count + i + 1) % Self.friendPoses.count])
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .card()
    }

    /// The closest friend: what it takes, how far you are, and one button to get there.
    private func nextFriend(_ item: HerdItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                Image(Self.friendPoses[1]).resizable().renderingMode(.template).scaledToFit()
                    .foregroundStyle(Color.secondary.opacity(0.35))
                    .frame(width: 54, height: 72)
                    .overlay(Text("?").font(.title2.weight(.bold)).foregroundStyle(.secondary))
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("Next friend", "次の仲間")).font(.caption.weight(.semibold)).foregroundStyle(Color.meadowLeaf)
                    Text(toGoText(item)).font(.system(.headline, design: .rounded)).fixedSize(horizontal: false, vertical: true)
                    ProgressView(value: item.share).tint(Color.meadowLeaf)
                    Text("\(item.current) / \(item.target)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            Button { goFor(item) } label: {
                Text(goText(item))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(Color.accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
        }
        .padding(12)
        .background(Color.meadowLeaf.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private func friend(_ item: HerdItem, pose: String) -> some View {
        VStack(spacing: 4) {
            Group {
                if item.earned {
                    Image(pose).resizable().scaledToFit()
                } else {
                    Image(pose).resizable().renderingMode(.template).scaledToFit().foregroundStyle(Color.secondary.opacity(0.28))
                }
            }
            .frame(width: 50, height: 66)
            Text(badgeName(item.badge)).font(.caption2.weight(item.earned ? .semibold : .regular))
                .foregroundStyle(item.earned ? Color.primary : Color.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            if !item.earned {
                Text("\(item.current)/\(item.target)").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .frame(width: 76)
    }

    private func toGoText(_ item: HerdItem) -> String {
        let n = item.toGo
        switch item.badge.group {
        case "articles": return L("Read \(n) more article\(n == 1 ? "" : "s")", "あと\(n)本の記事を読む")
        case "typed": return L("Type \(n) more words right", "あと\(n)語を正しく入力")
        case "streak": return L("Learn \(n) more day\(n == 1 ? "" : "s") in a row", "あと\(n)日続けて学習")
        default: return L("Learn \(n) more \(item.badge.value.text) words", "\(item.badge.value.text)の単語をあと\(n)語")
        }
    }

    private func goText(_ item: HerdItem) -> String {
        switch item.badge.group {
        case "articles": return L("Read an article", "記事を読む")
        case "typed": return L("Type words now", "単語を入力する")
        case "streak": return L("Learn today", "今日の学習をする")
        default: return L("Review words", "単語を復習する")
        }
    }

    private func goFor(_ item: HerdItem) {
        switch item.badge.group {
        case "articles": TabRouter.shared.tab = 0
        default: showReview = true    // typed words, streak and level all grow with the daily review
        }
    }

    private func badgeName(_ b: LearningProgress.Badge) -> String {
        let v = b.value.text
        switch b.group {
        case "level": return L("\(v) complete", "\(v) 達成")
        case "streak": return L("\(v)-day streak", "\(v)日連続")
        case "typed": return L("\(v) words typed", "\(v)語を入力")
        default: return L("\(v) articles read", "\(v)記事を読む")
        }
    }

    // MARK: Helpers

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(.secondary)
    }

    private func unitName(_ unit: String, _ value: Int) -> String {
        switch unit {
        case "days": return L(value == 1 ? "day" : "days", "日")
        case "weeks": return L(value == 1 ? "week" : "weeks", "週間")
        default: return L(value == 1 ? "month" : "months", "か月")
        }
    }

    /// "2027-06-14" → "June 2027" / "2027年6月"
    private func monthName(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return date }
        if isJapaneseUI { return "\(parts[0])年\(parts[1])月" }
        let names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        return "\(names[max(0, min(11, parts[1] - 1))]) \(parts[0])"
    }
}

private extension View {
    /// The white block used for streak, goals, weak spot and badges.
    func card() -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.cardBackground, in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color(.separator).opacity(0.35), lineWidth: 1))
    }
}

/// Opens Build Sentences for an article the progress screen only knows by its number.
struct SentencePracticeLoader: View {
    let articleId: Int
    @State private var article: Article?
    @State private var failed = false

    var body: some View {
        Group {
            if let article {
                SentencePracticeView(article: article)
            } else if failed {
                ContentUnavailableView(L("Not loaded", "読み込めません"), systemImage: "wifi.exclamationmark")
            } else {
                ProgressView()
            }
        }
        .task {
            do { article = try await APIClient.shared.fetchArticle(id: articleId) } catch { failed = true }
        }
    }
}

#Preview {
    NavigationStack { StatsView() }
}
