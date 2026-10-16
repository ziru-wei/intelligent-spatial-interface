import Foundation
import simd

// How the person stands to the room now, ported from the web editor (src/spatial-relations.mjs), from the head's pose and the layout's
// text surfaces (SpaceData surfaces.json). Space coordinates. One relation at a time, in this order:
//
//   A  a horizontal surface near the centre of view: the gaze ray first meets a box top (not the floor) under 1.5 m away, below the
//      eye (how far below does not matter), looking down (pitch under -15°): a desk, a counter. (The web's 1 m and 0.9 m are for a phone held at chest
//      height: with the headset's eyes those fail at a standing desk.)
//   B  facing a vertical surface nearby: the body's facing direction (the gaze, levelled, from the eye) first meets a wall face or a
//      box's side of at least 0.4 × 0.4 m, under 1.5 m away (perpendicular), within 30° of square on, with the eye in front of it.
//      When A and B both hold (a desk against a wall), looking down picks A (pitch under -25°), else B.
//   D  neither: the surface the gaze is on, if it is close and central enough:
//        floor          under 2.5 m, pitch under -35°, within 10° of the centre of view
//        window, door   under 3 m, within 15°
//        object         (any other box face) under 1 m and foveal: at least 4 of 5 rays within 5° of the centre on that object
//
// The A/B/D surface is what placement prefers (TextPlacement, InfoPlacement) and where the weather goes (WeatherTarget). The room's
// mesh (the headset's, where there is one) vetoes a surface something real stands in front of (a person, a shelf: `blocked`).
// RelationTracker adds the web's hysteresis over time.

struct SpatialRelation: Equatable {
    enum Kind: String { case A, B, D }
    let relation: Kind
    let kind: String?          // D: floor, window, door or object
    let surface: Surface
    let distance: Float
    let point: V3              // where the gaze (A, D) or the levelled facing ray (B) meets it
    static func == (a: Self, b: Self) -> Bool { a.relation == b.relation && a.surface === b.surface }
    var label: String { relation.rawValue + (kind.map { " " + $0 } ?? "") + " · " + (surface.label ?? surface.id) }
}

enum SpatialRelations {
    struct Limits {
        // A, for a headset: the web's 1 m and 0.2-0.9 m were set for a phone held at chest height; with the headset the height under the
        // eye does not matter (only that the top is under it), and its gaze meets the top 1-1.4 m away.
        static let aMaxDistance: Float = 1.5, aBelow: (Float, Float) = (0.1, 3), aMaxPitch: Float = -15
        static let bMaxDistance: Float = 1.5, bMaxAngle: Float = 30, bMinFace: Float = 0.4, bBeside: Float = 0.3, bLookDown: Float = -25
        static let dFloor = (maxDistance: Float(2.5), maxEcc: Float(10), maxPitch: Float(-35))
        static let dOpening = (maxDistance: Float(3), maxEcc: Float(15))
        static let dObject = (maxDistance: Float(1), cone: Float(5), minHits: 4)
        // Leaving a relation is easier than entering it: distances × 1.2, angles + 5°. A new state must hold this long (s) to replace the old.
        static let relaxDistance: Float = 1.2, relaxAngle: Float = 5, hold: Double = 0.5, objectHold: Double = 0.8, blocked: Float = 0.25
    }

    static func isOpening(_ s: Surface) -> Bool { s.kind == "window" || s.opening }
    static func isHorizontalBoxTop(_ s: Surface) -> Bool { s.family == "box" && s.normal.y > 0.9 }
    static func isVertical(_ s: Surface) -> Bool { abs(s.normal.y) < 0.3 }

    /// The first surface a ray meets (from its front, for one-sided surfaces).
    static func firstHit(_ surfaces: [Surface], _ origin: V3, _ dir: V3, filter: ((Surface) -> Bool)? = nil) -> (surface: Surface, distance: Float, point: V3)? {
        var best: (Surface, Float, V3)?
        for s in surfaces {
            if let filter, !filter(s) { continue }
            let den = simd_dot(dir, s.normal)
            if abs(den) < 1e-6 || (s.frontOnly && den >= 0) { continue }
            let d = simd_dot(s.origin - origin, s.normal)/den
            if d <= 0.02 || (best != nil && d >= best!.1) { continue }
            let p = origin + dir*d
            if s.contains(p) { best = (s, d, p) }
        }
        return best.map { ($0.0, $0.1, $0.2) }
    }

    static func pitch(_ dir: V3) -> Float { degrees(asin(min(1, max(-1, dir.y)))) }

    /// dir turned by `ecc` degrees away from itself, toward the direction at angle `around` degrees about it.
    static func rotateAround(_ dir: V3, _ ecc: Float, _ around: Float) -> V3 {
        guard ecc != 0 else { return dir }
        let side = abs(dir.y) > 0.95 ? V3(1, 0, 0) : worldUp
        let a = simd_cross(dir, side).normalized, b = simd_cross(a, dir)
        let axis = (a*cos(radians(around)) + b*sin(radians(around))).normalized
        return simd_quatf(angle: radians(ecc), axis: axis).act(dir)
    }

    /// Every relation that holds at this view, with thresholds relaxed when `relaxed`. blocked(origin, dir, distance): something real
    /// in the way, short of that distance.
    static func all(_ surfaces: [Surface], eye: V3, dir: V3, relaxed: Bool = false, blocked: (V3, V3, Float) -> Bool) -> [SpatialRelation.Kind: SpatialRelation] {
        let k: Float = relaxed ? Limits.relaxDistance : 1, da: Float = relaxed ? Limits.relaxAngle : 0, p = pitch(dir)
        func isBlocked(_ d: V3, _ distance: Float) -> Bool { blocked(eye, d, distance - Limits.blocked) }
        var out: [SpatialRelation.Kind: SpatialRelation] = [:]
        let gaze = firstHit(surfaces, eye, dir)
        // A: the gaze lands on a near box top below the eye.
        if let g = gaze, isHorizontalBoxTop(g.surface), p < Limits.aMaxPitch + da, g.distance < Limits.aMaxDistance*k {
            let below = eye.y - g.point.y
            if below >= Limits.aBelow.0/k, below <= Limits.aBelow.1*k, !isBlocked(dir, g.distance) {
                out[.A] = SpatialRelation(relation: .A, kind: nil, surface: g.surface, distance: g.distance, point: g.point)
            }
        }
        // B: what the body faces at eye height (a small box or a window in between means the person does not face the wall behind it).
        var level = dir; level.y = 0
        if level.length > 1e-3 {
            level = level.normalized
            if let f = firstHit(surfaces, eye, level, filter: isVertical),
               f.surface.family == "wall" || (f.surface.family == "box" && !f.surface.opening && f.surface.width >= Limits.bMinFace && f.surface.height >= Limits.bMinFace) {
                let t = f.surface, n = V3(t.normal.x, 0, t.normal.z).normalized
                let angle = degrees(acos(min(1, max(-1, -simd_dot(level, n)))))
                let perpendicular = simd_dot(eye - t.origin, t.normal), along = abs(simd_dot(eye - t.origin, t.right))
                if angle <= Limits.bMaxAngle + da, perpendicular > 0, perpendicular < Limits.bMaxDistance*k, along <= t.width/2 + Limits.bBeside, !isBlocked(level, f.distance) {
                    out[.B] = SpatialRelation(relation: .B, kind: nil, surface: t, distance: perpendicular, point: f.point)
                }
            }
        }
        // D: the surface under the gaze, strictly: the centre first, then rings out to maxEcc degrees.
        func probe(_ maxEcc: Float, _ accept: (Surface) -> Bool) -> (surface: Surface, distance: Float, point: V3)? {
            for ecc in [0, maxEcc/2, maxEcc] { for a in 0..<(ecc == 0 ? 1 : 8) {
                let r = rotateAround(dir, ecc, Float(a)*45)
                if let h = firstHit(surfaces, eye, r), accept(h.surface), !isBlocked(r, h.distance) { return h }
            } }
            return nil
        }
        if p < Limits.dFloor.maxPitch + da, let f = probe(Limits.dFloor.maxEcc + da, { $0.family == "floor" }), f.distance < Limits.dFloor.maxDistance*k {
            out[.D] = SpatialRelation(relation: .D, kind: "floor", surface: f.surface, distance: f.distance, point: f.point)
        }
        if out[.D] == nil, let o = probe(Limits.dOpening.maxEcc + da, isOpening), o.distance < Limits.dOpening.maxDistance*k {
            out[.D] = SpatialRelation(relation: .D, kind: o.surface.kind == "window" ? "window" : "door", surface: o.surface, distance: o.distance, point: o.point)
        }
        if out[.D] == nil, let g = gaze, g.surface.family == "box", !g.surface.opening, g.distance < Limits.dObject.maxDistance*k, !isBlocked(dir, g.distance), let id = g.surface.objectId {
            let hits = (0..<5).filter { a in firstHit(surfaces, eye, a == 0 ? dir : rotateAround(dir, Limits.dObject.cone, Float(a)*90))?.surface.objectId == id }.count
            if hits >= Limits.dObject.minHits { out[.D] = SpatialRelation(relation: .D, kind: "object", surface: g.surface, distance: g.distance, point: g.point) }
        }
        return out
    }

    /// The one relation at this view (A, B or D, or nil).
    static func pick(_ all: [SpatialRelation.Kind: SpatialRelation], dir: V3) -> SpatialRelation? {
        if let a = all[.A], let b = all[.B] { return pitch(dir) < Limits.bLookDown ? a : b }
        return all[.A] ?? all[.B] ?? all[.D]
    }
}

/// Hysteresis over time: the relation changes only after the new state has held for `hold` seconds (0.8 s for objects), and the
/// current one stays while it holds under relaxed thresholds. A gap of more than a second starts over.
final class RelationTracker {
    private(set) var current: SpatialRelation?
    private var pending: SpatialRelation?, since = Date.distantPast, last: Date?

    func update(_ surfaces: [Surface], head: HeadPose, blocked: (V3, V3, Float) -> Bool, now: Date = Date()) -> SpatialRelation? {
        let all = SpatialRelations.all(surfaces, eye: head.eye, dir: head.forward, blocked: blocked)
        let next = SpatialRelations.pick(all, dir: head.forward)
        defer { last = now }
        guard let l = last, now.timeIntervalSince(l) <= 1 else { current = next; pending = nil; return current }
        if next == current { pending = nil; current = next; return current }
        // The current one still holds when relaxed: only a different relation may take over (after its hold), not nothing.
        let keep = current.flatMap { c in
            SpatialRelations.all(surfaces, eye: head.eye, dir: head.forward, relaxed: true, blocked: blocked)[c.relation].flatMap { $0.surface === c.surface ? $0 : nil }
        }
        if let keep, next == nil { pending = nil; current = keep; return current }
        if next != pending { pending = next; since = now }
        let hold = (next ?? current)?.kind == "object" ? SpatialRelations.Limits.objectHold : SpatialRelations.Limits.hold
        if now.timeIntervalSince(since) >= hold { current = next; pending = nil }
        else if let keep { current = keep }
        return current
    }
}
