import SwiftUI
import AVFoundation

// MARK: - Listen to the article (2026-11-11, for 1.4)
// Cloud voice first: the server reads each sentence with Google's Neural2
// voice (GET /api/articles/:id/speech/:index, cached server-side after the
// first play). If that fails (offline, server error), the free on-device
// Japanese voice reads the sentence instead. Sentence by sentence, so the
// current sentence can be shown, repeated, skipped and slowed down.

@Observable
class ArticleSpeaker: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    enum Speed: Double, CaseIterable, Identifiable {
        case slow, medium, normal
        var id: Self { self }
        var label: String {
            switch self {
            case .slow: return "Slow"
            case .medium: return "Medium"
            case .normal: return "Normal"
            }
        }
        /// AVAudioPlayer rate (pitch stays the same)
        var playerRate: Float { self == .slow ? 0.75 : self == .medium ? 0.88 : 1.0 }
        /// AVSpeechUtterance rate for the on-device fallback
        var speechRate: Float { self == .slow ? 0.33 : self == .medium ? 0.42 : 0.5 }
    }

    var sentences: [String] = []
    var index = 0
    var isPlaying = false
    var isLoading = false
    var speed: Speed = .medium
    var voiceName = ""
    /// Cloud voice the learner picked: "female" (Neural2-B) or "male" (Neural2-C)
    var voice: String = UserDefaults.standard.string(forKey: "speechVoice") ?? "female" {
        didSet { UserDefaults.standard.set(voice, forKey: "speechVoice") }
    }

    private var articleId: Int?
    private var cloudAvailable = false
    private var audioCache: [Int: Data] = [:]
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private var generation = 0          // bumps on every stop/skip, so late downloads are ignored

    override init() {
        super.init()
        synth.delegate = self
    }

    /// Loads the sentence list from the server (cloud voice); falls back to
    /// splitting the article text locally (on-device voice).
    func load(articleId: Int, body: String) async {
        guard sentences.isEmpty else { return }
        self.articleId = articleId
        isLoading = true
        if let speech = try? await APIClient.shared.fetchSpeech(articleId: articleId), !speech.sentences.isEmpty {
            sentences = speech.sentences
            cloudAvailable = true
        } else {
            sentences = RomajiToKana.sentences(of: body).map(\.romaji)
        }
        isLoading = false
    }

    func playPause() {
        if isPlaying { stop() } else { playCurrent() }
    }

    func jump(by delta: Int) {
        index = min(max(index + delta, 0), max(sentences.count - 1, 0))
        if isPlaying { stop(); playCurrent() }
    }

    func setSpeed(_ s: Speed) {
        speed = s
        if let player { player.rate = s.playerRate }
        if synth.isSpeaking { stop(); playCurrent() }
    }

    func setVoice(_ v: String) {
        guard v != voice else { return }
        voice = v
        audioCache = [:]
        if isPlaying { stop(); playCurrent() }
    }

    func stop() {
        generation += 1
        player?.stop()
        player = nil
        synth.stopSpeaking(at: .immediate)
        isPlaying = false
    }

    private func playCurrent() {
        guard index < sentences.count else { index = 0; return }
        generation += 1
        let gen = generation
        let i = index
        isPlaying = true
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        guard cloudAvailable, let articleId else { speakOnDevice(i); return }
        Task { @MainActor in
            let data = try? await self.audio(articleId: articleId, index: i)
            guard gen == self.generation else { return }
            if let data, let p = try? AVAudioPlayer(data: data) {
                p.enableRate = true
                p.rate = self.speed.playerRate
                p.delegate = self
                self.player = p
                self.voiceName = self.voice == "male" ? "Male" : "Female"
                p.play()
                self.prefetch(articleId: articleId, index: i + 1)
            } else {
                self.speakOnDevice(i)
            }
        }
    }

    private func audio(articleId: Int, index: Int) async throws -> Data {
        if let cached = audioCache[index] { return cached }
        isLoading = true
        defer { isLoading = false }
        let data = try await APIClient.shared.fetchSentenceAudio(articleId: articleId, index: index, voice: voice)
        audioCache[index] = data
        return data
    }

    /// Download the next sentence while this one plays, so there is no gap
    private func prefetch(articleId: Int, index: Int) {
        guard index < sentences.count, audioCache[index] == nil else { return }
        let v = voice
        Task { @MainActor in
            if let data = try? await APIClient.shared.fetchSentenceAudio(articleId: articleId, index: index, voice: v),
               v == self.voice {
                self.audioCache[index] = data
            }
        }
    }

    private func speakOnDevice(_ i: Int) {
        let u = AVSpeechUtterance(string: RomajiToKana.convert(sentences[i]))
        let ja = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("ja") }
        u.voice = ja.max { $0.quality.rawValue < $1.quality.rawValue } ?? AVSpeechSynthesisVoice(language: "ja-JP")
        voiceName = u.voice?.name ?? "?"
        u.rate = speed.speechRate
        synth.speak(u)
    }

    private func finishedSentence() {
        guard isPlaying else { return }
        if index + 1 < sentences.count {
            index += 1
            // short pause between sentences
            let gen = generation
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                guard gen == self.generation, self.isPlaying else { return }
                self.playCurrent()
            }
        } else {
            isPlaying = false
            index = 0
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { if player === self.player { self.finishedSentence() } }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.finishedSentence() }
    }
}

struct ArticleAudioBar: View {
    @Bindable var speaker: ArticleSpeaker
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            if speaker.index < speaker.sentences.count {
                Text(speaker.sentences[speaker.index])
                    .font(.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(3)
            }
            HStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(speaker.index + 1)/\(speaker.sentences.count)")
                        .font(.caption.monospacedDigit())
                    if speaker.isLoading {
                        ProgressView().controlSize(.mini)
                    } else {
                        Text(speaker.voiceName)
                            .font(.caption2)
                    }
                }
                .fixedSize()
                .foregroundStyle(.secondary)
                Spacer()
                Button { speaker.jump(by: -1) } label: { Image(systemName: "backward.fill") }
                Button { speaker.playPause() } label: {
                    Image(systemName: speaker.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 40))
                }
                .accessibilityLabel(speaker.isPlaying ? "Pause" : "Play")
                Button { speaker.jump(by: 1) } label: { Image(systemName: "forward.fill") }
                Spacer()
                Menu {
                    Section("Speed") {
                        ForEach(ArticleSpeaker.Speed.allCases) { s in
                            Button { speaker.setSpeed(s) } label: {
                                if s == speaker.speed { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                            }
                        }
                    }
                    Section("Voice") {
                        ForEach([("female", "Female"), ("male", "Male")], id: \.0) { key, label in
                            Button { speaker.setVoice(key) } label: {
                                if key == speaker.voice { Label(label, systemImage: "checkmark") } else { Text(label) }
                            }
                        }
                    }
                } label: {
                    Text(speaker.speed.label).font(.caption.weight(.semibold)).fixedSize()
                }
                Button { speaker.stop(); onClose() } label: { Image(systemName: "xmark") }
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.regularMaterial)
    }
}
