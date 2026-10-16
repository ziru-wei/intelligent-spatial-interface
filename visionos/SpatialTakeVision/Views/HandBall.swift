import RealityKit
import UIKit
import simd

/// A hand's gesture, seen: a small glowing ball under the palm (PALM_GAP below it, along the palm's normal) while the palm faces down
/// and the gesture is armed. As the hand closes it draws in (smaller, brighter, turning from soft white to the hand's colour); when the
/// fist is made it bursts (its halo swells and fades) and goes. World coordinates.
@MainActor
final class HandBall: Entity {
    static let palmGap: Float = 0.06, radius: Float = 0.016
    let color: UIColor
    private let core = ModelEntity(), halo = ModelEntity()
    private var level: Float = 0          // shown: 0 → 1 as it fades in
    private var burst: Date?              // the fist was made then
    private var shownTint: UIColor?

    required init() { color = .white; super.init() }
    init(color: UIColor) {
        self.color = color; super.init()
        core.model = ModelComponent(mesh: .generateSphere(radius: Self.radius), materials: [])
        halo.model = ModelComponent(mesh: .generateSphere(radius: Self.radius*2.2), materials: [])
        addChild(halo); addChild(core)
        components.set(OpacityComponent(opacity: 0)); isEnabled = false
    }

    /// Each frame: where the palm is and which way it faces (nil: not tracked), whether the gesture is armed (palm down, hand open, or
    /// closing), and how far it has closed (0 open … 1 a fist). dt: seconds since the last frame.
    func update(palm: V3?, normal: V3?, armed: Bool, progress: Float, dt: Float, time: Float) {
        if let b = burst {
            let t = Float(Date().timeIntervalSince(b))/0.45
            if t >= 1 { burst = nil; level = 0; isEnabled = false; return }
            if let palm, let normal { position = palm + normal*Self.palmGap }
            setTint(color)
            core.scale = V3(repeating: 1.2*(1 - t))
            halo.scale = V3(repeating: 1 + 2.5*t)
            components.set(OpacityComponent(opacity: 1 - t))
            return
        }
        level = armed && palm != nil ? min(1, level + dt*6) : max(0, level - dt*5)
        isEnabled = level > 0
        guard level > 0, let palm, let normal else { return }
        position = palm + normal*Self.palmGap
        let p = max(0, min(1, progress))
        setTint(Self.mix(UIColor(white: 0.95, alpha: 1), color, p))
        let breathe = 1 + 0.06*sin(time*6)
        core.scale = V3(repeating: (1 - 0.35*p)*breathe)
        halo.scale = V3(repeating: (1 - 0.2*p)*breathe)
        components.set(OpacityComponent(opacity: level*(0.65 + 0.35*p)))
    }

    /// The fist is made: the burst.
    func fire() { burst = Date(); isEnabled = true }

    private func setTint(_ c: UIColor) {
        guard c != shownTint else { return }
        shownTint = c
        var m = UnlitMaterial(color: c); m.readsDepth = false; m.writesDepth = false; m.blending = .transparent(opacity: .init(floatLiteral: 1))
        var h = UnlitMaterial(color: c); h.readsDepth = false; h.writesDepth = false; h.blending = .transparent(opacity: .init(floatLiteral: 0.22))
        core.model?.materials = [m]; halo.model?.materials = [h]
    }
    private static func mix(_ a: UIColor, _ b: UIColor, _ t: Float) -> UIColor {
        var (r1, g1, b1, a1, r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0, 0, 0, 0, 0)
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1); b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        let k = CGFloat((t*8).rounded()/8)   // in eighths: the material changes only now and then
        return UIColor(red: r1 + (r2 - r1)*k, green: g1 + (g2 - g1)*k, blue: b1 + (b2 - b1)*k, alpha: 1)
    }
}
