import SwiftUI
import RealityKit

/// Spatial Take on Apple Vision Pro: the web editor's agent, live. A window to connect to the agent on the Mac, align the scene's layout
/// with the room, and ask; answers go onto the room's real surfaces in a mixed immersive space.
@main
struct SpatialTakeVisionApp: App {
    @State private var model = AppModel()

    var body: some SwiftUI.Scene {
        WindowGroup(id: AppModel.panelID) {
            ControlWindow().environment(model)
                .onAppear { model.panelOpen = true }.onDisappear { Diag.mark("window closed"); model.panelOpen = false }
                .modifier(PhaseLog(name: "window"))
        }
        .defaultSize(width: 560, height: 820)

        ImmersiveSpace(id: AppModel.roomSpaceID) {
            RoomView().environment(model)
        }
        .immersionStyle(selection: .constant(.mixed), in: .mixed)
        .upperLimbVisibility(.visible)   // the hands over the app's content: the only thing that covers what is drawn over the room
    }
}

/// The room: the app's entities, in the headset's world, and within reach in it the ask bar with the weather's controls and the
/// settings (when opened from the bar) above it.
struct RoomView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    var body: some View {
        RealityView { content, _ in
            content.add(model.root)
        } update: { _, attachments in
            // Read so this runs again when the weather comes or goes (its controls show above the ask bar) or the bar's status changes size.
            _ = (model.weather, model.askStatus, model.settingsInRoom, model.barsHidden, model.barList, model.pastQuestions.count, model.locationLabel.isEmpty)
            model.attachPanels(ask: attachments.entity(for: "ask"), weather: attachments.entity(for: "weather"), settings: attachments.entity(for: "settings"))
            model.attachVoiceCaption(attachments.entity(for: "voice"))
        } attachments: {
            Attachment(id: "ask") { AskBar().environment(model) }
            Attachment(id: "weather") { WeatherControls().environment(model) }
            Attachment(id: "voice") { VoiceCaption().environment(model) }
            Attachment(id: "settings") {
                ControlWindow().environment(model)
                    .frame(width: 560, height: 760)
                    .glassBackgroundEffect()
                    .simultaneousGesture(TapGesture().onEnded { model.noteInteraction() })
            }
        }
        // The settings' grip, dragged by hand: the panel goes with it.
        .gesture(DragGesture().targetedToEntity(model.settingsGrip).onChanged { v in model.dragSettings(to: v.convert(v.location3D, from: .local, to: .scene)) })
        .task { await model.roomOpened() }
        // The room closing (the Digital Crown, or the app quitting): nothing is reopened, so the app can go.
        .onDisappear {
            Diag.mark("room closed (its view went)")
            model.roomClosedEarly = Date().timeIntervalSince(model.roomOpenedAt) < 3   // visionOS took it back (seen ~0.35 s after opening at launch)
            model.roomOpen = false; model.settingsInRoom = false
        }
        .onChange(of: phase) { _, p in Diag.mark("room scene: \(p)") }
    }
}

/// The weather's controls in the room (the web editor's in-scene preview, src/weather-preview.mjs): the day buttons when the forecast
/// spans days, play / pause, the time slider, and the time, sky and temperature shown.
struct WeatherControls: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let w = model.weather, !w.entries.isEmpty {
            let entries = w.entries, index = min(model.weatherIndex, entries.count - 1), entry = entries[index]
            let dates = Array(Set(entries.map(\.date))).sorted()
            VStack(spacing: 12) {
                if dates.count > 1 {
                    HStack(spacing: 10) {
                        ForEach(dates, id: \.self) { d in
                            Button(String(d.suffix(5)).replacingOccurrences(of: "-", with: "/")) {
                                model.noteInteraction()
                                if let i = entries.firstIndex(where: { $0.date == d }) { model.weatherIndex = i }
                            }
                            .buttonStyle(.bordered).tint(d == entry.date ? .accentColor : nil)
                        }
                    }
                }
                if entries.count > 1 {
                    HStack(spacing: 12) {
                        Button { model.noteInteraction(); model.weatherPlaying.toggle() } label: { Image(systemName: model.weatherPlaying ? "pause.fill" : "play.fill") }
                            .buttonStyle(.borderless).buttonBorderShape(.circle)
                        // Within the day shown when there are day buttons, else across all.
                        let local = dates.count > 1 ? entries.indices.filter { entries[$0].date == entry.date } : Array(entries.indices)
                        Slider(value: Binding(get: { Double(local.firstIndex(of: index) ?? 0) }, set: { model.noteInteraction(); model.weatherIndex = local[min(local.count - 1, max(0, Int($0.rounded())))] }),
                               in: 0...Double(max(1, local.count - 1)), step: 1)
                            .disabled(local.count < 2)
                    }
                }
                Text(entry.label).font(.headline).multilineTextAlignment(.center)
            }
            .padding(20)
            .frame(width: 420)
            .glassBackgroundEffect()
        }
    }
}

/// Logs a scene's phase changes (Diag).
struct PhaseLog: ViewModifier {
    let name: String
    @Environment(\.scenePhase) private var phase
    func body(content: Content) -> some View { content.onChange(of: phase) { _, p in Diag.mark("\(name) scene: \(p)") } }
}

/// What is heard during a voice episode (the right fist held), word by word as it is recognised, floating over the back of the hand.
struct VoiceCaption: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let t = model.speech.transcript
        Text(t.isEmpty ? "Listening…" : t)
            .font(.system(size: 34, weight: .semibold))
            .foregroundStyle(.white.opacity(t.isEmpty ? 0.7 : 1))
            .shadow(color: .black.opacity(0.6), radius: 6)
            .multilineTextAlignment(.center)
            .frame(width: 520)
            .animation(.easeOut(duration: 0.15), value: t)
    }
}
