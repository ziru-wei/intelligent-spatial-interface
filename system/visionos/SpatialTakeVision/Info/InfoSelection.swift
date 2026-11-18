import Foundation
import simd

// What the user means when asking: a thing carrying info (a layout box with an info key, the editor's Layout section; or the zone they
// stand in), ported from the web editor (src/user-selection.mjs selectInfoBox, src/app.mjs computeSelection). Space coordinates.
//   gaze   the fovea: the head points the gaze (apps get no eye tracking). Inside FOVEA.inner of the head's forward 1, falling to 0 at
//          FOVEA.outer, by the angle to the nearest seen point of the box (its centre, face centres, edge midpoints, corners).
//   point  an index finger straight and out (tip farther from the wrist than the knuckle by 30%, and 4 cm from it), aimed at the box:
//          1 when its ray (knuckle → tip, from the tip) passes through it, else by the angle to it (POINT.inner → POINT.outer).
//          ARKit's 3D joints (the web judged this in the image, where its depth on a finger was unreliable).
//   touch  a joint of a hand at the box's surface (TOUCH.inner → TOUCH.outer metres).
// Only boxes within reason count: within REACH (2 m) of the eye (to the box's nearest surface), seen no more than OBLIQUE (60°) off
// square across (left or right of its main upright face: the largest, and any nearly as large) nor more than OBLIQUE above or below.
// Each box's evidence: score = 1 − (1 − .75 gaze)(1 − .85 point)(1 − .95 touch). Gaze and pointing also lean (up to 15%) toward the
// box whose centre is nearer the line, so boxes side by side inside the fovea do not tie.
// The user means at most one thing: each box's share is the chance that it alone is meant (its score, every other one's 1 − score),
// with what is left for nothing meant; the shares and nothing add up to 1 (odds s/(1 − s) over 1 + their sum). The most likely of
// these is the selection: the best box when its share beats nothing's (alone, that is its score at or above SELECT_MIN, as before). A zone carrying info that the user stands in is a weak candidate (ZONE_SELECTION) when nothing
// else is selected; the agent's Jev judges it.

/// A hand's joints that selection uses: the wrist, the index finger's knuckle and tip, and every joint (for touching). WorldSensing.Hand.
struct HandJoints { let wrist: V3; let indexKnuckle: V3; let indexTip: V3; let joints: [V3] }

struct InfoTarget: Equatable {
    let id: String          // layout:<box> or zone:<zone>, as the server names it (scripts/info_context.py)
    let key: String
    let center: V3, size: V3, yaw: Float   // a box (zones have none: zero size)
    let label: String?
}

struct InfoSelectionResult {
    /// score: the box's own evidence; share: the chance it is the one meant (the shares and `nothing` add up to 1).
    struct Score { let target: InfoTarget; let score: Float; var share: Float; let gaze: Float; let point: Float; let touch: Float; let zone: Bool }
    let selected: Score?
    let scores: [Score]     // best share first
    let nothing: Float
    /// The selection as the server takes it (POST /api/agent/questions `selection`).
    var payload: [String: Any]? {
        guard let s = selected else { return nil }
        var cues: [String: Any] = ["gaze": Double(s.gaze), "point": Double(s.point), "touch": Double(s.touch)]
        if s.zone { cues["zone"] = 1.0 }
        return ["box_id": s.target.id, "key": s.target.key, "score": Double(s.share), "cues": cues]
    }
}

enum InfoSelection {
    static let fovea = (inner: Float(8), outer: Float(20)), point = (inner: Float(6), outer: Float(18)), touch = (inner: Float(0.05), outer: Float(0.15))
    static let weight = (gaze: Float(0.75), point: Float(0.85), touch: Float(0.95)), selectMin: Float = 0.5, zoneSelection: Float = 0.4
    static let central: Float = 0.15, reach: Float = 2, oblique: Float = 60

    /// Whether the box is near enough and seen squarely enough to be meant (see above).
    static func inReason(_ t: InfoTarget, eye: V3) -> Bool {
        guard surfaceDistance(eye, t) <= reach else { return false }
        let d = t.center - eye, len = d.length
        if len > 1e-3, degrees(asin(min(1, abs(d.y)/len))) > oblique { return false }
        // Across: the eye's direction in the box's frame, levelled, against its main upright faces (±x: y × z, ±z: x × y).
        var l = frame(t).inverse.vector(eye - t.center); l.y = 0
        guard l.length > 1e-3 else { return true }
        l = l.normalized
        let ax = t.size.y*t.size.z, az = t.size.x*t.size.y, big = max(ax, az)
        var best: Float = 180
        if ax >= 0.7*big { best = min(best, degrees(acos(min(1, abs(l.x))))) }
        if az >= 0.7*big { best = min(best, degrees(acos(min(1, abs(l.z))))) }
        return best <= oblique
    }

    /// Everything in the space carrying info: its boxes (furniture, doors and windows), the live session's scene objects and zones.
    static func targets(_ sem: Semantic) -> [InfoTarget] {
        let boxes = (sem.objects + sem.openings).compactMap { b -> InfoTarget? in
            guard let k = b.info, !k.isEmpty, let c = b.center, let s = b.size else { return nil }
            return InfoTarget(id: "layout:" + b.id, key: k, center: V3(c), size: V3(s), yaw: radians(Float(b.yaw ?? 0)), label: b.label)
        }
        let objects = (sem.infoObjects ?? []).map { o in
            InfoTarget(id: o.id, key: o.info, center: V3(o.center), size: V3(o.size), yaw: radians(Float(o.yaw ?? 0)), label: o.label)
        }
        let zones = sem.rooms.compactMap { r -> InfoTarget? in
            guard let k = r.info, !k.isEmpty else { return nil }
            return InfoTarget(id: "zone:" + r.id, key: k, center: .zero, size: .zero, yaw: 0, label: r.name)
        }
        return boxes + objects + zones
    }

    static func frame(_ t: InfoTarget) -> simd_float4x4 { simd_float4x4(yaw: t.yaw, translation: t.center) }
    /// The box's centre, face centres, edge midpoints and corners (what angles are measured to).
    static func boxPoints(_ t: InfoTarget) -> [V3] {
        let m = frame(t), h = t.size/2
        var out: [V3] = []
        for x: Float in [-1, 0, 1] { for y: Float in [-1, 0, 1] { for z: Float in [-1, 0, 1] { out.append(m.point(V3(x*h.x, y*h.y, z*h.z))) } } }
        return out
    }
    static func rayHitsBox(_ o: V3, _ d: V3, _ t: InfoTarget) -> Bool {
        let inv = frame(t).inverse, lo3 = inv.point(o), ld = inv.vector(d), h = t.size/2
        var lo: Float = 0, hi = Float.infinity
        for a in 0..<3 {
            if abs(ld[a]) < 1e-9 { if abs(lo3[a]) > h[a] { return false }; continue }
            var t1 = (-h[a] - lo3[a])/ld[a], t2 = (h[a] - lo3[a])/ld[a]
            if t1 > t2 { swap(&t1, &t2) }
            lo = max(lo, t1); hi = min(hi, t2); if lo > hi { return false }
        }
        return true
    }
    /// Degrees between a ray and the nearest of the points ahead of it (0 when the ray goes through the box); nil when none is ahead.
    static func angleTo(_ o: V3, _ d: V3, _ t: InfoTarget, points: [V3]) -> Float? {
        if rayHitsBox(o, d, t) { return 0 }
        var best: Float?
        for p in points { let v = p - o; if simd_dot(v, d) <= 0 { continue }; let a = degrees(acos(min(1, max(-1, simd_dot(v.normalized, d))))); if best == nil || a < best! { best = a } }
        return best
    }
    static func surfaceDistance(_ p: V3, _ t: InfoTarget) -> Float {
        let l = frame(t).inverse.point(p), h = t.size/2
        return simd_length(simd_max(abs(l) - h, .zero))
    }

    /// head: space; hands: space; visible(points) → which are in plain sight; zoneAt: the zone the user stands in.
    /// zones: the zone the user stands in, then one they face (Location): the first carrying info is the weak zone candidate.
    static func select(_ targets: [InfoTarget], head: HeadPose, hands: [HandJoints], visible: ([V3]) -> [Bool], zones: [String]) -> InfoSelectionResult {
        // Fingers pointing: straight and out from the palm.
        let rays = hands.compactMap { h -> (V3, V3)? in
            let along = h.indexTip - h.indexKnuckle
            guard along.length >= 0.04, simd_distance(h.indexTip, h.wrist) >= simd_distance(h.indexKnuckle, h.wrist)*1.3 else { return nil }
            return (h.indexTip, along.normalized)
        }
        var scores: [InfoSelectionResult.Score] = []
        for t in targets where t.size != .zero && inReason(t, eye: head.eye) {
            // Only boxes the fovea reaches are checked for being in sight (rays through the room's mesh).
            let pts = boxPoints(t), near = (angleTo(head.eye, head.forward, t, points: pts) ?? .infinity) < fovea.outer
            let seen = near ? zip(pts, visible(pts)).filter { $0.1 }.map(\.0) : []
            let gaze = seen.isEmpty ? 0 : ramp(angleTo(head.eye, head.forward, t, points: seen) ?? .infinity, fovea.inner, fovea.outer)*centred(head.eye, head.forward, t, fovea.outer)
            let pt = rays.map { r in (angleTo(r.0, r.1, t, points: pts).map { ramp($0, point.inner, point.outer) } ?? 0)*centred(r.0, r.1, t, point.outer) }.max() ?? 0
            let tc = hands.flatMap(\.joints).map { ramp(surfaceDistance($0, t), touch.inner, touch.outer) }.max() ?? 0
            let score = 1 - (1 - weight.gaze*gaze)*(1 - weight.point*pt)*(1 - weight.touch*tc)
            if score > 0 { scores.append(.init(target: t, score: score, share: 0, gaze: gaze, point: pt, touch: tc, zone: false)) }
        }
        // Exactly one meant, or none: odds over 1 + their sum.
        let odds = scores.map { min($0.score, 0.995)/(1 - min($0.score, 0.995)) }, total = 1 + odds.reduce(0, +)
        for i in scores.indices { scores[i].share = odds[i]/total }
        scores.sort { $0.share > $1.share }
        var selected = scores.first.flatMap { $0.share > 1/total ? $0 : nil }
        if selected == nil, let t = zones.lazy.compactMap({ z in targets.first(where: { $0.id == "zone:" + z }) }).first {
            selected = .init(target: t, score: zoneSelection, share: zoneSelection, gaze: 0, point: 0, touch: 0, zone: true)
        }
        return InfoSelectionResult(selected: selected, scores: scores, nothing: 1/total)
    }

    /// 1 when the ray goes through the box's centre, down to 1 − `central` at `outer` degrees off it.
    static func centred(_ o: V3, _ d: V3, _ t: InfoTarget, _ outer: Float) -> Float {
        let v = (t.center - o).normalized, a = degrees(acos(min(1, max(-1, simd_dot(v, d)))))
        return 1 - central*min(1, a/outer)
    }
}
