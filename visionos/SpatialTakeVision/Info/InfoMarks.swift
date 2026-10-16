import RealityKit
import UIKit
import simd

/// What an info answer draws besides its text, after the web editor (src/info-visual.mjs), in space coordinates:
///   corners  glowing right angles at the four corners of its box's face toward the viewer, a little inside them (12% of the face's
///            shorter side), a little toward the viewer
///   arrow    a short straight line on the line from the text's centre to the centre of that face, ending at the box's outline, with an
///            open head (at most ARROW_DEG long as seen; none when the text and the box overlap); turned to face the viewer each frame
///   lock     a padlock at the text's upper right once the answer has settled on a surface
/// Their colour is a vivid accent picked against the scan's colours on that face (Legibility.accent), with a soft halo.
@MainActor
final class InfoMarks: Entity {
    static let arrowDeg: Float = 5
    private var arrow: (from: V3, to: V3)?
    private var shaft = ModelEntity(), head1 = ModelEntity(), head2 = ModelEntity()
    private var width: Float = 0.006
    required init() { super.init() }

    /// box: the info target; text: where the answer's text is (space); surfaces: for the colours on the box's face.
    convenience init(box t: InfoTarget, text p: PlacedText, eye: V3, surfaces: [Surface], thickness: Float) {
        self.init()
        let face = Self.face(t, eye: eye)
        // The accent: against what the scan saw on that face (its surface's baked colours), amber over dark when unknown.
        let s = surfaces.filter { $0.label != nil && simd_dot($0.normal, face.normal) > 0.9 && simd_distance($0.origin, face.center) < 0.05 + max(face.ha, face.hb) }
            .min { simd_distance($0.origin, face.center) < simd_distance($1.origin, face.center) }
        let pixels = s.flatMap { s -> [SIMD3<UInt8>]? in let l = s.local(face.center); return s.colors?.region(x0: l.x - face.ha, x1: l.x + face.ha, y0: l.y - face.hb, y1: l.y + face.hb, limit: 300).pixels }
        let accent = Legibility.accent(pixels: pixels ?? [])
        let color = UIColor(linear: accent.color), halo = UIColor(linear: accent.halo)
        func mat(_ c: UIColor, _ o: Float) -> UnlitMaterial { var m = UnlitMaterial(color: c); m.blending = .transparent(opacity: .init(floatLiteral: o)); m.writesDepth = false; return m }

        // Corners.
        let short = min(face.ha, face.hb)*2, inset = min(0.03, max(0.004, short*0.12)), arm = min(0.09, max(0.025, short*0.3)), w: Float = 0.007
        for sa: Float in [-1, 1] { for sb: Float in [-1, 1] {
            let at = face.center + face.a*(sa*(face.ha - inset)) + face.b*(sb*(face.hb - inset)) + face.normal*0.02
            for dir in [face.a*(-sa), face.b*(-sb)] {
                for (mw, m) in [(w*3.2, mat(halo, 0.35)), (w, mat(color, 1))] {
                    let bar = ModelEntity(mesh: .generatePlane(width: arm + mw - w, height: mw), materials: [m])
                    bar.transform = Transform(matrix: simd_float4x4(right: dir, up: simd_cross(face.normal, dir).normalized, normal: face.normal, origin: at + dir*(arm/2) + face.normal*(mw == w ? 0.001 : 0)))
                    addChild(bar)
                }
            }
        } }

        // The arrow: from the text's edge toward the face's centre, ending at the box's outline.
        let c = p.center, d = face.center - c, len = d.length
        if len > 1e-3 {
            let dir = d/len
            // Where the line leaves the text's rectangle, and where it meets the box.
            let tr = abs(simd_dot(dir, p.right)), tu = abs(simd_dot(dir, p.up))
            let leave = min(tr > 1e-4 ? p.width/2/tr : .infinity, tu > 1e-4 ? p.height/2/tu : .infinity)
            let enter = Self.entry(c, dir, t) ?? len
            let gap: Float = 0.02, end = enter - gap, maxLen = simd_distance(eye, c + dir*end)*tan(radians(Self.arrowDeg))
            let start = max(leave + gap, end - maxLen)
            if end - start > 0.03 { arrow = (c + dir*start, c + dir*end) }
        }
        width = 0.006*thickness
        shaft.model = ModelComponent(mesh: .generatePlane(width: 1, height: 1), materials: [mat(color, 1)])
        head1.model = shaft.model; head2.model = shaft.model
        for e in [shaft, head1, head2] { e.isEnabled = arrow != nil; addChild(e) }

        // The lock.
        if p.settled, let cg = UIImage(systemName: "lock.fill")?.withTintColor(.white, renderingMode: .alwaysOriginal).cgImage,
           let tex = try? TextureResource(image: cg, options: .init(semantic: .color)) {
            var m = UnlitMaterial(); m.color = .init(tint: color, texture: .init(tex)); m.blending = .transparent(opacity: .init(floatLiteral: 0.95))
            let size = max(0.018, p.width*0.05), lock = ModelEntity(mesh: .generatePlane(width: size, height: size*Float(cg.height)/Float(cg.width)), materials: [m])
            lock.transform = Transform(matrix: p.transform*simd_float4x4(translation: V3(p.width/2 - size, p.height/2 + size*0.8, 0.003)))
            addChild(lock)
        }
        update(eye: eye)
    }

    /// Turns the arrow to face the viewer (a flat stroke seen edge-on would vanish).
    func update(eye: V3) {
        guard let a = arrow else { return }
        let along = a.to - a.from, l = along.length, dir = along/l
        let side = simd_cross(dir, (eye - (a.from + a.to)/2).normalized).normalized
        func stroke(_ e: ModelEntity, from p: V3, to q: V3) {
            let v = q - p, n = v.length, x = v/n, y = side, z = simd_cross(x, y).normalized
            e.transform = Transform(matrix: simd_float4x4(right: x, up: simd_cross(z, x), normal: z, origin: (p + q)/2)*simd_float4x4(SIMD4(n, 0, 0, 0), SIMD4(0, width, 0, 0), SIMD4(0, 0, 1, 0), SIMD4(0, 0, 0, 1)))
        }
        stroke(shaft, from: a.from, to: a.to)
        let h = min(0.035, l*0.35)
        stroke(head1, from: a.to - dir*h + side*(h*0.6), to: a.to); stroke(head2, from: a.to - dir*h - side*(h*0.6), to: a.to)
    }

    /// The box's face toward the eye: centre, outward normal, in-plane axes a, b and half sizes along them.
    static func face(_ t: InfoTarget, eye: V3) -> (center: V3, normal: V3, a: V3, b: V3, ha: Float, hb: Float) {
        let m = InfoSelection.frame(t), toEye = m.inverse.vector(eye - t.center).normalized, h = t.size/2
        var best = (k: 0, s: Float(1), d: -Float.infinity)
        for k in 0..<3 { for s: Float in [1, -1] { let d = s*toEye[k]; if d > best.d { best = (k, s, d) } } }
        let unit = { (k: Int) -> V3 in var v = V3.zero; v[k] = 1; return m.vector(v) }
        let others = (0..<3).filter { $0 != best.k }
        let normal = unit(best.k)*best.s
        return (t.center + normal*h[best.k], normal, unit(others[0]), unit(others[1]), h[others[0]], h[others[1]])
    }
    /// How far along a ray from `o` it enters the box (nil if it misses).
    static func entry(_ o: V3, _ d: V3, _ t: InfoTarget) -> Float? {
        let inv = InfoSelection.frame(t).inverse, lo3 = inv.point(o), ld = inv.vector(d), h = t.size/2
        var lo: Float = 0, hi = Float.infinity
        for a in 0..<3 {
            if abs(ld[a]) < 1e-9 { if abs(lo3[a]) > h[a] { return nil }; continue }
            var t1 = (-h[a] - lo3[a])/ld[a], t2 = (h[a] - lo3[a])/ld[a]; if t1 > t2 { swap(&t1, &t2) }
            lo = max(lo, t1); hi = min(hi, t2); if lo > hi { return nil }
        }
        return lo
    }
}

extension Legibility {
    /// A vivid colour for a thin mark over a background, and a halo for under it (src/legibility.mjs accentStyle): lightness away from
    /// most of the background, a strongly saturated hue opposite the background's own (amber over a neutral dark, blue over a neutral
    /// light), the halo at the other end of lightness. Linear RGB.
    static func accent(pixels: [SIMD3<UInt8>]) -> (color: SIMD3<Float>, halo: SIMD3<Float>, light: Bool) {
        let lab = pixels.map { linToOklab(SIMD3(toLin(Float($0.x)/255), toLin(Float($0.y)/255), toLin(Float($0.z)/255))) }
        let Ls = lab.map(\.x).sorted(), q60 = Ls.isEmpty ? 0.3 : Ls[min(Ls.count - 1, Int(0.6*Float(Ls.count)))]
        let mean = lab.isEmpty ? SIMD3<Float>(0.3, 0, 0) : lab.reduce(SIMD3<Float>(repeating: 0), +)/Float(lab.count)
        let light = q60 < 0.62, L: Float = light ? 0.86 : 0.42, chroma = hypot(mean.y, mean.z)
        let hue = chroma > 0.02 ? atan2(mean.z, mean.y) + .pi : (light ? 1.25 : -1.85)
        var c: Float = 0.2, color = oklabToLin(SIMD3(L, 0, 0))
        while c >= 0 { let rgb = oklabToLinRaw(SIMD3(L, c*cos(hue), c*sin(hue))); if rgb.min() >= 0 && rgb.max() <= 1 { color = rgb; break }; c -= 0.01 }
        return (color, oklabToLin(light ? SIMD3(0.16, 0, 0) : SIMD3(0.98, 0, 0)), light)
    }
}
