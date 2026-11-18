import SwiftUI

/// The app's window, laid out like the web editor's side panel: a segmented control on top (Scene · Agent · Behavior, and Questions:
/// the headset's past questions, replayed in the room), each page its own scrolling form.
struct ControlWindow: View {
    enum Page: String, CaseIterable, Identifiable { case scene = "Scene", agent = "Agent", behavior = "Behavior", questions = "Questions"; var id: Self { self } }
    @Environment(AppModel.self) private var model
    @Environment(\.openImmersiveSpace) private var openImmersiveSpace
    @Environment(\.scenePhase) private var phase
    @State private var page: Page = .scene

    var body: some View {
        VStack(spacing: 0) {
            RoomStatus()
            Picker("Page", selection: $page) { ForEach(Page.allCases) { Text($0.rawValue).tag($0) } }
                .pickerStyle(.segmented)
                .padding([.horizontal, .top], 24).padding(.bottom, 8)
            // Each page is its own form (its own scroll view), shown alone: no scroll view nests another.
            switch page {
            case .scene: ScenePage()
            case .agent: AgentPage()
            case .behavior: BehaviorPage()
            case .questions: QuestionsPage()
            }
        }
        // The room opens with the app, once: answers and weather are in it, whether Room view (the debug overlay) is on or not. Not again
        // when the window comes back (visionOS restores it after the Digital Crown closes the room: the app is being left).
        .task {
            Diag.mark("window shown")
            guard !model.roomOpen, !AppModel.roomOpenedOnce else { return }
            AppModel.roomOpenedOnce = true
            // Not while the app is still launching: a room opened before this window is active is taken back by visionOS at once.
            for _ in 0..<50 where phase != .active { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .milliseconds(400))
            await openRoom()
        }
        // The room closed by itself moments after opening (visionOS takes back a room opened as the app launches, at times), with this
        // window still in front: opened again, twice at most.
        .onChange(of: model.roomOpen) { _, open in
            guard !open, model.roomClosedEarly, model.roomReopens < 2 else { return }
            Task {
                try? await Task.sleep(for: .milliseconds(600))
                guard phase == .active, !model.roomOpen else { return }
                model.roomReopens += 1; Diag.mark("the room closed by itself: opening it again")
                await openRoom()
            }
        }
    }

    private func openRoom() async {
        Diag.mark("opening the room")
        let r = await openImmersiveSpace(id: AppModel.roomSpaceID); Diag.mark("open room: \(r)")
    }
}

/// A fixed strip on top: is the room ready (its mesh scanned, walls and floor found) and aligned. While the mesh is still coming in the
/// headset is busy and placement is unreliable.
private struct RoomStatus: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openImmersiveSpace) private var openImmersiveSpace
    var body: some View {
        let r = model.sensing.room
        HStack(spacing: 14) {
            if !model.roomOpen {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                Text("The room is closed")
                Button("Open") { Task { Diag.mark("Open pressed"); let r = await openImmersiveSpace(id: AppModel.roomSpaceID); Diag.mark("Open: \(r)") } }
            } else {
                Image(systemName: r.meshReady ? "checkmark.circle.fill" : "hourglass").foregroundStyle(r.meshReady ? .green : .yellow)
                Text(r.meshReady ? "Room mesh ready" : r.meshPieces == 0 ? "Scanning the room…" : "Scanning the room… (\(r.meshPieces) pieces)")
                Text("\(r.walls) walls · \(r.floors) floors · \(r.tables) tables").foregroundStyle(.secondary)
                Spacer()
                Image(systemName: model.worldFromSpace == nil ? "location.slash" : model.anchored ? "location.fill" : "location")
                Text(model.worldFromSpace == nil ? "Not aligned" : model.anchored ? "Aligned (saved)" : "Aligned").foregroundStyle(.secondary)
            }
        }
        .font(.footnote)
        .padding(.horizontal, 24).padding(.top, 18)
    }
}

/// A labeled slider with its value (format: printf, the value × scale).
func slider(_ label: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, _ format: String, _ scale: Double = 1) -> some View {
    HStack { Text(label); Slider(value: value, in: range); Text(String(format: format, value.wrappedValue*scale)).monospacedDigit() }
}

/// Room view and alignment.
private struct ScenePage: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openImmersiveSpace) private var openImmersiveSpace
    @Environment(\.dismissImmersiveSpace) private var dismissImmersiveSpace
    @State private var fine = true

    var body: some View {
        @Bindable var model = model
        Form {
            if let error = model.loadError { Section { Text(error).foregroundStyle(.red) } }
            Section {
                if model.showLayout && !model.selectionSummary.isEmpty { Text(model.selectionSummary).font(.footnote) }
                Toggle("Real things hide answers", isOn: $model.behavior.occlusion)
                Text(model.sensing.status).font(.footnote).foregroundStyle(.secondary)
            } header: { Text("Room") } footer: {
                Text("Room view (its button on the ask bar) draws the room's metadata over it (the layout's walls, furniture and openings), for debugging and aligning. Answers and weather show either way.")
            }
            Section("Alignment · \(model.space?.scanLabel ?? AppModel.spaceName)") {
                Picker("I am in", selection: $model.zone) {
                    Text("Anywhere (all walls)").tag(String?.none)
                    ForEach(model.space?.zones ?? [], id: \.id) { z in Text(z.name ?? z.id).tag(Optional(z.id)) }
                }
                HStack {
                    Button("Auto-align") { model.autoAlign() }.disabled(!model.roomOpen || model.refining)
                    Button("Refine") { Task { await model.refineAlignment() } }.disabled(!model.roomOpen || model.refining || model.worldFromSpace == nil)
                    if model.refining { ProgressView().controlSize(.small) }
                }
                Toggle("Fine steps (1 cm, 0.5°)", isOn: $fine)
                let step: Float = fine ? 0.01 : 0.05, turn: Float = fine ? 0.5 : 2
                HStack(spacing: 10) {
                    nudge("arrow.counterclockwise", .turnLeft, turn); nudge("arrow.left", .left, step); nudge("arrow.up", .forward, step)
                    nudge("arrow.down", .back, step); nudge("arrow.right", .right, step); nudge("arrow.clockwise", .turnRight, turn)
                    nudge("arrow.up.to.line", .up, step); nudge("arrow.down.to.line", .down, step)
                }
                .disabled(model.worldFromSpace == nil)
                Button("Save alignment") { Task { await model.saveAlignment() } }.disabled(model.worldFromSpace == nil || !model.roomOpen)
                Text(model.alignmentStatus).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func nudge(_ icon: String, _ n: AppModel.Nudge, _ step: Float) -> some View {
        Button { model.nudge(n, step: step) } label: { Image(systemName: icon) }
            .buttonStyle(.bordered).buttonBorderShape(.circle)
    }
}

/// The agent: connection, asking, and the mods.
private struct AgentPage: View {
    enum Mod: String, CaseIterable, Identifiable { case info = "Info", findmy = "FindMy", weather = "Weather"; var id: Self { self } }
    @Environment(AppModel.self) private var model
    @State private var mod: Mod = .info

    var body: some View {
        @Bindable var model = model
        Form {
            Section("Agent on the Mac") {
                Text(model.agentConfig?.server ?? "Not set up: run `visionos/tools/mac.sh prepare` on the Mac, then build again.").font(.footnote)
                Button("Connect") { Task { await model.connect() } }.disabled(model.agentConfig == nil)
                Text(model.connectionStatus).font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                if !model.askStatus.isEmpty { Text(model.askStatus).font(.footnote).foregroundStyle(.secondary) }
                if !model.lastAnswer.isEmpty { Text(model.lastAnswer) }
                Button("Clear answers", role: .destructive) { model.stopReplay(); model.clearAnswers() }
            } header: { Text("Last answer") } footer: { Text("Ask from the bar in the room, below your view: by voice or a ready-made question.") }
            Section {
                Picker("Mod", selection: $mod) { ForEach(Mod.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented)
                switch mod {
                case .info:
                    Picker("Selection decided by", selection: $model.behavior.selectionMode) { Text("Jev judgement").tag("jev"); Text("Score only").tag("score") }
                        .pickerStyle(.segmented)
                case .findmy:
                    Toggle("FindMy mod", isOn: $model.behavior.findmyMod)
                    Toggle("Remove when a hand approaches", isOn: $model.behavior.findmyRemoveOnApproach)
                    if model.behavior.findmyRemoveOnApproach { slider("Approach distance", $model.behavior.findmyApproach, 0.05...0.5, "%.0f cm", 100) }
                case .weather:
                    Toggle("Weather mod", isOn: $model.weatherMod)
                    Toggle("Lock location", isOn: $model.weatherLock)
                }
            } header: { Text("Mods") }
        }
    }

}

/// How answers look.
private struct BehaviorPage: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        @Bindable var model = model
        Form {
            Section("Answer text") {
                HStack {
                    Text("Body size")
                    Slider(value: $model.bodySize, in: 0.6...2.5)
                    Text(String(format: "%.2f×", model.bodySize)).monospacedDigit()
                }
                Toggle("Show heading", isOn: $model.behavior.showHeading)
                if model.behavior.showHeading { slider("Heading size", $model.behavior.headingSize, 0.5...2, "%.2f×") }
                Toggle("Write answers", isOn: $model.behavior.writing)
                if model.behavior.writing {
                    Toggle("Pen strokes", isOn: $model.behavior.writingStrokes)
                    slider("Writing speed", $model.behavior.writingSpeed, 5...120, "%.0f chars/s")
                }
            }
            Section("Question bar and weather controls") {
                Picker("Follow me", selection: $model.behavior.followMode) { Text("Lazily").tag("lazy"); Text("In real time").tag("realtime") }
                    .pickerStyle(.segmented)
            }
            Section("Placement") {
                slider("Placement stability", $model.behavior.stability, 0...1, "%.0f%%", 100)
                slider("Info: smallest on a surface", $model.behavior.infoMinShrink, 0.25...1, "%.0f%%", 100)
                slider("Info: parallel to the box within", $model.behavior.floatParallel, 0...90, "%.0f°")
                slider("Info: arrow thickness", $model.behavior.arrowWidth, 0.5...3, "%.2f×")
            }
        }
    }
}

/// The questions asked on the headset; one replays, in the room now, as it happened.
private struct QuestionsPage: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Form {
            Section {
                Button("Refresh") { Task { await model.loadQuestions() } }.disabled(model.agentConfig == nil)
                if !model.questionsStatus.isEmpty { Text(model.questionsStatus).font(.footnote).foregroundStyle(.secondary) }
                if model.replaying != nil { Button("Stop replay", role: .destructive) { model.stopReplay(); model.clearAnswers() } }
            } footer: {
                Text("Replays the agent's answer as it came (its timing, its weather), placed where you look now. The agent is not asked again.")
            }
            Section("Asked on the headset") {
                ForEach(model.pastQuestions) { q in
                    Button { model.replay(q) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(q.question.text).font(.headline)
                                if q.hasWeather { Image(systemName: "cloud.sun") }
                                Spacer()
                                if model.replaying == q.id { Image(systemName: "play.circle.fill").foregroundStyle(Color.accentColor) }
                            }
                            if let a = q.answerText { Text(a).font(.footnote).foregroundStyle(.secondary).lineLimit(2) }
                            Text(q.question.created.map { Date(timeIntervalSince1970: $0).formatted(date: .abbreviated, time: .shortened) } ?? q.conversationName)
                                .font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
        .task { if model.pastQuestions.isEmpty { await model.loadQuestions() } }
    }
}
