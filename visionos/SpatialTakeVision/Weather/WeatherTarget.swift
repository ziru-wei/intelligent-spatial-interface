import Foundation
import simd

/// Where the weather shows (space coordinates), by how the person stands to the room (SpatialRelations), in this order:
///   window   a window in a wide part of the view (about ±36° across, ±29° up and down): probes over it (7 × 8) each take the nearest
///            surfaces they meet, and a window among them scores by how central it is (x² + 0.65 y²); skipped looking steeply down.
///            The whole window takes the effect. A window shown stays while any of it is still in view (±50°, ±40°): looking up a
///            little does not give it to the ceiling.
///   table    a desk or table: A (under the gaze, near), or the gaze's first surface is a desk top within DESK_GAZE (2 m), or the
///            user stands at one: a top under the eye (how far under does not matter) within DESK_AHEAD (1.2 m) across ±25° of the facing direction: a patch on it, at most 1.1 × 0.85 m
///            and 60% of the top each way, on its far side (the near side keeps room for the text), inside it.
///   wall     B, a wall or tall side faced: an upright patch around where the gaze (or else the facing ray) meets it, inside it, sized
///            by its distance (near: small, far: large; WALL_PATCH metres wide per metre away, about 30° across, within its limits,
///            1.15 × as high).
///   ceiling  none of these: the ceiling over the person (else the nearest), whole.
/// Never the floor.
struct WeatherTarget {
    let surface: Surface
    let center: V3, right: V3, up: V3, normal: V3     // normal toward the viewer
    let width: Float, height: Float
    let whole: Bool                                    // the whole window or ceiling (its own outline), else a patch
    var focus: V3? = nil                               // where the gaze met it (rain from a ceiling falls around there)
    var kind: String { surface.kind }
    var horizontal: Bool { abs(normal.y) > 0.7 }
    var frame: simd_float4x4 { simd_float4x4(right: right, up: up, normal: normal, origin: center) }

    static func hit(_ s: Surface, origin: V3, dir: V3, far: Float = 20) -> Float? {
        let den = simd_dot(dir, s.normal)
        guard abs(den) > 1e-5 else { return nil }
        let t = simd_dot(s.origin - origin, s.normal)/den
        guard t > 0.1, t < far, s.contains(origin + dir*t) else { return nil }
        return t
    }

    static let wallPatch = (perMetre: Float(0.55), min: Float(0.3), max: Float(1.4), tall: Float(1.15))

    static func select(_ surfaces: [Surface], head: HeadPose, relation: SpatialRelation?, current: WeatherTarget? = nil) -> WeatherTarget? {
        let dir = head.forward
        // The window shown still in view: it stays.
        if let c = current, c.kind == "window", dir.y >= -0.6 {
            let corners = [(-1, -1), (1, -1), (1, 1), (-1, 1), (0, 0)].map { (sx: Float, sy: Float) in c.surface.point(V2(sx*c.surface.width/2, sy*c.surface.height/2)) }
            if corners.contains(where: { TextPlacement.viewAngles($0, head: head).map { abs($0.x) < 50 && abs($0.y) < 40 } ?? false }) {
                return whole(c.surface, at: c.focus ?? c.center, head: head)
            }
        }
        // A window anywhere in a wide part of the view (Vision Pro's is wider than a phone's).
        var window: (s: Surface, p: V3, score: Float)? = nil
        if dir.y >= -0.6 {
            for y: Float in [0.8, 0.55, 0.3, 0.1, -0.1, -0.3, -0.55, -0.8] { for x: Float in [-0.8, -0.55, -0.3, 0, 0.3, 0.55, 0.8] {
                let d = (dir + head.right*(x*0.9) + head.up*(y*0.7)).normalized
                let hits = surfaces.compactMap { s in hit(s, origin: head.eye, dir: d).map { (s, $0) } }.sorted { $0.1 < $1.1 }
                guard let first = hits.first?.1 else { continue }
                for (s, t) in hits where t <= first + 0.08 && s.kind == "window" {
                    let score = x*x + y*y*0.65
                    if window == nil || score < window!.score { window = (s, head.eye + d*t, score) }
                }
            } }
        }
        if let w = window { return whole(w.s, at: w.p, head: head) }
        let desk: (Surface, V3)? = relation?.relation == .A ? (relation!.surface, relation!.point) : deskInFront(surfaces, head: head)
        if let desk {
            let s = desk.0, point = desk.1, toward = s.local(head.eye), at = s.local(point)
            // Pushed away from the viewer along the top's axis that points at them most.
            var away = V2(at.x - toward.x, at.y - toward.y); away = abs(away.x)/s.width > abs(away.y)/s.height ? V2(away.x > 0 ? 1 : -1, 0) : V2(0, away.y > 0 ? 1 : -1)
            let w = min(1.1, s.width*0.6), h = min(0.85, s.height*0.6)
            let far = V2(away.x*(s.width - (abs(away.x) > 0 ? w : h))/2, away.y*(s.height - (abs(away.y) > 0 ? h : w))/2)
            let p = s.point(V2(away.x != 0 ? far.x : at.x, away.y != 0 ? far.y : at.y))
            return patch(s, at: p, head: head, size: (w, h), cap: true)
        }
        if let r = relation, r.relation == .B {
            // Where the gaze meets the faced surface, else the facing ray's point at eye height less 10 cm.
            var at = hit(r.surface, origin: head.eye, dir: dir).map { head.eye + dir*$0 } ?? r.point
            if hit(r.surface, origin: head.eye, dir: dir) == nil { at.y = head.eye.y - 0.1 }
            let w = max(wallPatch.min, min(wallPatch.max, wallPatch.perMetre*simd_distance(head.eye, at)))
            return patch(r.surface, at: at, head: head, size: (w, w*wallPatch.tall))
        }
        // The ceiling over the person, else the nearest one.
        let ceilings = surfaces.filter { $0.kind == "ceiling" }
        let over = ceilings.first { s in
            let den = simd_dot(worldUp, s.normal); guard abs(den) > 1e-4 else { return false }
            let t = simd_dot(s.origin - head.eye, s.normal)/den; return t > 0 && s.contains(head.eye + worldUp*t)
        }
        guard let c = over ?? ceilings.min(by: { simd_distance($0.origin.xz, head.eye.xz) < simd_distance($1.origin.xz, head.eye.xz) }) else { return nil }
        return whole(c, at: V3(head.eye.x, c.origin.y, head.eye.z), head: head)
    }

    static let deskAhead: Float = 1.2, deskGaze: Float = 2, deskFan: Float = 25
    static let deskPattern = try! NSRegularExpression(pattern: "desk|table|counter|workbench|bench", options: .caseInsensitive)
    static func isDesk(_ s: Surface) -> Bool {
        let text = (s.label ?? "") + " " + (s.objectId ?? "")
        return deskPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }
    static func isDeskTop(_ s: Surface) -> Bool { s.family == "box" && s.normal.y > 0.9 && !s.opening && isDesk(s) }
    /// A desk or table top in front (by its label: not a sofa or a shelf): the gaze's first surface within DESK_GAZE, else the nearest
    /// the levelled facing direction crosses within DESK_AHEAD, 0.2-0.9 m below the eye.
    static func deskInFront(_ surfaces: [Surface], head: HeadPose) -> (Surface, V3)? {
        if let g = SpatialRelations.firstHit(surfaces, head.eye, head.forward), isDeskTop(g.surface), g.distance < deskGaze { return (g.surface, g.point) }
        return deskAhead(surfaces, head: head)
    }
    /// A desk, table or counter top the user stands at: under the eye (how far under does not matter), crossed by a fan of levelled rays
    /// across ±DESK_FAN° of the facing direction within DESK_AHEAD; the nearest.
    static func deskAhead(_ surfaces: [Surface], head: HeadPose) -> (Surface, V3)? {
        var level = head.forward; level.y = 0
        guard level.length > 1e-3 else { return nil }
        level = level.normalized
        let tops = surfaces.filter { isDeskTop($0) && $0.origin.y < head.eye.y - 0.1 }
        for step in stride(from: Float(0.1), through: deskAhead, by: 0.05) {
            for a in stride(from: Float(0), through: deskFan, by: 5) { for sign: Float in (a == 0 ? [1] : [1, -1]) {
                let d = simd_quatf(angle: radians(a*sign), axis: worldUp).act(level)
                for s in tops { let p = V3(head.eye.x + d.x*step, s.origin.y, head.eye.z + d.z*step); if s.contains(p) { return (s, p) } }
            } }
        }
        return nil
    }

    /// Facing the viewer; upright surfaces keep gravity up, lying ones read away from the viewer.
    private static func frame(_ s: Surface, at p: V3, head: HeadPose) -> (n: V3, up: V3, right: V3) {
        var n = s.normal
        if simd_dot(n, head.eye - s.origin) < 0 { n = -n }
        var up = abs(n.y) < 0.7 ? worldUp - n*simd_dot(worldUp, n) : { let a = p - head.eye; return a - n*simd_dot(a, n) }()
        if up.length < 1e-4 { up = s.up }
        up = up.normalized
        return (n, up, simd_cross(up, n).normalized)
    }

    private static func whole(_ s: Surface, at p: V3, head: HeadPose) -> WeatherTarget {
        let f = frame(s, at: p, head: head)
        return WeatherTarget(surface: s, center: s.origin, right: f.right, up: f.up, normal: f.n, width: s.width, height: s.height, whole: true, focus: p)
    }

    /// A patch around a point, kept inside the surface's rectangle (in the surface's own axes); size along the viewer-facing axes.
    /// cap: the size is already in the surface's own axes (width along s.right).
    private static func patch(_ s: Surface, at p: V3, head: HeadPose, size: (Float, Float), cap: Bool = false) -> WeatherTarget {
        let f = frame(s, at: p, head: head)
        // The surface's own width runs along s.right.
        let alongRight = abs(simd_dot(s.right, f.right)) > 0.7
        let sw = alongRight || cap ? size.0 : size.1, sh = alongRight || cap ? size.1 : size.0
        var w = min(sw, s.width*0.94), h = min(sh, s.height*0.94)
        let l = s.local(p)
        var cx = max(-(s.width - w)/2, min((s.width - w)/2, l.x)), cy = max(-(s.height - h)/2, min((s.height - h)/2, l.y))
        // Inside the surface's own outline, not only its rectangle (a round table): drawn toward its middle, then smaller, until all four
        // corners are on it.
        // (Its corners as it is drawn: along the viewer-facing axes.)
        func fits() -> Bool {
            let c = s.point(V2(cx, cy)), rw = alongRight ? w : h, rh = alongRight ? h : w
            return [(-1, -1), (1, -1), (1, 1), (-1, 1)].allSatisfy { (x: Float, y: Float) in s.contains(c + f.right*(x*rw/2) + f.up*(y*rh/2)) }
        }
        var k = 0
        while !fits() && k < 24 {
            if k % 2 == 0 { cx *= 0.8; cy *= 0.8 } else { w *= 0.9; h *= 0.9 }
            k += 1
        }
        return WeatherTarget(surface: s, center: s.point(V2(cx, cy)), right: f.right, up: f.up, normal: f.n, width: alongRight ? w : h, height: alongRight ? h : w, whole: false, focus: p)
    }

    /// Whether another target is the same place (the web: same surface, within 18 cm, facing the same way).
    func same(as o: WeatherTarget) -> Bool {
        surface === o.surface && simd_distance(center, o.center) < 0.18 && simd_dot(normal, o.normal) > 0.98
    }
}
