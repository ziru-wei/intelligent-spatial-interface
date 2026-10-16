import AVFoundation

/// What a hand gesture did, heard: a short tone, rising when something starts or shows, falling when it stops or hides. (What it
/// looks like is the ball under the palm: HandBall.)
@MainActor
final class GestureFeedback {
    enum Kind {
        case voiceOn, voiceOff, barsShown, barsHidden
        var rising: Bool { self == .voiceOn || self == .barsShown }
    }
    private var players: [AVAudioPlayer] = []

    func play(_ kind: Kind) { play(kind.rising) }

    /// Two short notes, a fifth apart: up or down.
    private func play(_ rising: Bool) {
        let notes: [Double] = rising ? [660, 990] : [990, 660]
        guard let player = try? AVAudioPlayer(data: Self.wav(notes)) else { return }
        player.volume = 0.5; player.play()
        players.removeAll { !$0.isPlaying }; players.append(player)
    }

    /// A 16-bit mono WAV of the notes, 70 ms each, with soft edges.
    static func wav(_ notes: [Double], rate: Double = 44100, each: Double = 0.07) -> Data {
        var samples: [Int16] = []
        for f in notes {
            let n = Int(rate*each)
            for i in 0..<n {
                let t = Double(i)/rate, edge = min(1, min(Double(i), Double(n - i))/(rate*0.008))
                samples.append(Int16(sin(2*Double.pi*f*t)*edge*0.6*Double(Int16.max)))
            }
        }
        var d = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        let bytes = UInt32(samples.count*2)
        d.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes); d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate)*2); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(bytes)
        samples.withUnsafeBytes { d.append(contentsOf: $0) }
        return d
    }
}
