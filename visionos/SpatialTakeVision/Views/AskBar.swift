import SwiftUI
import Speech
import AVFoundation

/// The question bar, in the room within reach (below the eye, following the user: AppModel.followPanels): icon buttons only (no
/// typing on the headset): voice (speak; sent once you pause), ready-made questions (sent when picked), past questions (replayed as
/// they were answered: no new request to the agent), clear (every answer in the room goes, with its weather and FindMy), Room view (the layout drawn over the room), and the settings (a panel over the bar). Below them what is heard while
/// speaking, else the agent's status.
struct AskBar: View {
    static let presets = [
        "What's the weather tonight?", "What's the weather this weekend?", "Where are my headphones?", "What's the lab's vision?",
        "What's Sean's vision?", "Can you tell me more about the speaker of this talk?", "What's this?", "Can I eat this?",
    ]
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    private var speech: SpeechInput { model.speech }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 14) {
                Button { model.noteInteraction(); speech.listening ? speech.stop() : speech.start() } label: {
                    Image(systemName: speech.listening ? "mic.fill" : "mic").font(.title2).frame(width: 44, height: 44)
                }
                .tint(speech.listening ? .red : nil).help("Speak")
                // Lists open under the bar (visionOS shows no menus in a room).
                Button { model.noteInteraction(); model.barList = model.barList == "presets" ? nil : "presets" } label: {
                    Image(systemName: model.barList == "presets" ? "text.bubble.fill" : "text.bubble").font(.title2).frame(width: 44, height: 44)
                }
                .help("Ready-made questions")
                Button {
                    model.noteInteraction(); model.barList = model.barList == "history" ? nil : "history"
                    if model.barList != nil { Task { await model.loadQuestions() } }
                } label: { Image(systemName: "clock.arrow.circlepath").font(.title2).frame(width: 44, height: 44) }
                .tint(model.barList == "history" ? .accentColor : nil).help("Past questions")
                Button { model.noteInteraction(); model.barList = nil; model.stopReplay(); model.clearAnswers() } label: {
                    Image(systemName: "eraser").font(.title2).frame(width: 44, height: 44)
                }
                .help("Clear all answers")
                Button { model.noteInteraction(); model.showLayout.toggle() } label: {
                    Image(systemName: model.showLayout ? "square.3.layers.3d.top.filled" : "square.3.layers.3d").font(.title2).frame(width: 44, height: 44)
                }
                .tint(model.showLayout ? .accentColor : nil).help("Room view")
                Button {
                    model.noteInteraction()
                    // In the room: the panel over the bar (the window, if open, goes: one place for settings).
                    if model.roomOpen {
                        model.settingsInRoom.toggle()
                        if model.settingsInRoom && model.panelOpen { dismissWindow(id: AppModel.panelID) }
                    } else if model.panelOpen { dismissWindow(id: AppModel.panelID) } else { openWindow(id: AppModel.panelID) }
                } label: { Image(systemName: model.settingsInRoom ? "gearshape.fill" : "gearshape").font(.title2).frame(width: 44, height: 44) }
                    .help("Settings")
            }
            .buttonStyle(.borderless).buttonBorderShape(.circle)
            if let list = model.barList {
                let items: [(String, () -> Void)] = list == "presets"
                    ? Self.presets.map { q in (q, { ask(q) }) }
                    : model.pastQuestions.prefix(15).map { q in (q.question.text, { model.noteInteraction(); if speech.listening { speech.stop() }; model.barList = nil; model.replay(q) }) }   // newest first
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        if items.isEmpty { Text(model.questionsStatus.isEmpty ? "No past questions" : model.questionsStatus).font(.caption).foregroundStyle(.secondary).padding(8) }
                        ForEach(items.indices, id: \.self) { i in
                            Button { items[i].1() } label: { Text(items[i].0).font(.callout).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6).padding(.horizontal, 10) }
                                .buttonStyle(.borderless)
                        }
                    }
                }
                .frame(width: 300, height: 220)
            }
            let line = speech.listening ? (speech.transcript.isEmpty ? "Listening…" : speech.transcript) : speech.error ?? model.askStatus
            if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1).frame(maxWidth: 260) }
            // Where the agent takes "here" and "this lab" to be.
            if !model.locationLabel.isEmpty { Text(model.locationLabel).font(.caption2).foregroundStyle(.tertiary).lineLimit(1).frame(maxWidth: 280) }
        }
        .padding(12)
        .glassBackgroundEffect()
        .task { await model.loadQuestions() }
    }

    private func ask(_ q: String) {
        model.noteInteraction(); model.barList = nil
        let text = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if speech.listening { speech.stop() }
        Task { await model.ask(text); await model.loadQuestions() }
    }
}

/// Speech to text (English) while listening: the transcript as it is heard, word by word. Done (`onFinish` gets what was said) once the
/// speaker pauses for `pause` seconds after saying something; or, held (the right hand's fist: AppModel), only when `end()` is called.
@MainActor
@Observable
final class SpeechInput {
    var listening = false
    var transcript = ""
    var finished = false
    var error: String?
    /// Held open: no pause ends it, only end().
    var holding = false
    @ObservationIgnored var onFinish: ((String) -> Void)?
    @ObservationIgnored private var cancelled = false
    static let pause: TimeInterval = 1.5
    @ObservationIgnored private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var silence: Task<Void, Never>?

    func start(hold: Bool = false) {
        error = nil; finished = false; transcript = ""; holding = hold; cancelled = false
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard !self.cancelled else { return }
                guard status == .authorized else { self.error = "Speech recognition is not allowed (Settings › Privacy)."; return }
                guard await AVAudioApplication.requestRecordPermission() else { self.error = "The microphone is not allowed (Settings › Privacy)."; return }
                guard !self.cancelled else { return }
                self.begin()
            }
        }
    }

    private func begin() {
        guard let recognizer, recognizer.isAvailable else { error = "Speech recognition is not available now."; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .mixWithOthers])   // the gestures' tones still play
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let request = SFSpeechAudioBufferRecognitionRequest(); request.shouldReportPartialResults = true; self.request = request
            let input = engine.inputNode, format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            engine.prepare(); try engine.start()
            listening = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, err in
                Task { @MainActor in
                    guard let self, self.listening else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        self.armSilence()
                        if result.isFinal { self.finish() }
                    } else if err != nil { self.stop() }
                }
            }
        } catch { self.error = "Could not start listening: \(error.localizedDescription)"; stop() }
    }

    /// After each heard word: done if nothing more comes within `pause` seconds.
    private func armSilence() {
        silence?.cancel()
        guard !holding else { return }
        silence = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.pause))
            guard !Task.isCancelled else { return }
            self?.finish()
        }
    }
    private func finish() {
        guard listening else { return }
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        stop(); if !text.isEmpty { finished = true; onFinish?(text) }
    }

    /// The held episode is over (the fist let go): what was said is sent; before listening began, nothing starts.
    func end() { if listening { finish() } else { cancelled = true }; holding = false }

    func stop() {
        silence?.cancel(); silence = nil
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio(); task?.cancel(); request = nil; task = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
