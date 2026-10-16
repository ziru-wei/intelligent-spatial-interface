import Foundation
import simd

/// Where the user is, for the agent (editor/scripts/location.py): the zone they stand in, and a zone they face without being in it —
/// the gaze, or a pointing finger (tried first), meets a door, window or opening within REACH whose other side (a point DEPTH beyond it
/// along the ray) is in another zone; or, without that, the user stands within NEAR_DOOR of a door or opening into another zone (about to
/// go in), whichever way they look. "here", "this lab" then mean those zones.
struct Location {
    var inZone: String?
    var facing: (zone: String, via: String)?
    static let reach: Float = 6, depth: Float = 0.6, nearDoor: Float = 1.2

    var payload: [String: Any]? {
        guard inZone != nil || facing != nil else { return nil }
        var d: [String: Any] = [:]
        if let inZone { d["in"] = inZone }
        if let f = facing { d["facing"] = ["zone": f.zone, "via": f.via] }
        return d
    }

    static func find(_ sem: Semantic, eye: V3, rays: [(o: V3, d: V3, pointing: Bool)]) -> Location {
        let inZone = sem.rooms.first { $0.contains(eye) }?.id
        let openings = sem.openings.compactMap { o -> (InfoTarget, String)? in
            guard let c = o.center, let s = o.size else { return nil }
            let kind = (o.category ?? o.label ?? "").lowercased()
            // A little thicker than the wall's opening, so a ray through it counts.
            return (InfoTarget(id: o.id, key: "", center: V3(c), size: V3(s) + V3(0, 0, 0.1), yaw: radians(Float(o.yaw ?? 0)), label: o.label),
                    kind.contains("window") ? "window" : kind.contains("door") ? "door" : "opening")
        }
        for r in rays {
            let hit = openings.filter { simd_distance($0.0.center, r.o) < reach && InfoSelection.rayHitsBox(r.o, r.d, $0.0) }
                .min { simd_distance($0.0.center, r.o) < simd_distance($1.0.center, r.o) }
            guard let (box, via) = hit else { continue }
            let t = simd_dot(box.center - r.o, r.d), beyond = r.o + r.d*(t + depth)
            if let z = sem.rooms.first(where: { $0.contains(beyond) })?.id, z != inZone { return Location(inZone: inZone, facing: (z, r.pointing ? "pointing" : via)) }
        }
        // Near a door into another zone: the zone on its far side from the user.
        let near = openings.filter { $0.1 != "window" }.map { (box: $0.0, d: simd_distance($0.0.center.xz, eye.xz)) }.filter { $0.d < nearDoor }.sorted { $0.d < $1.d }
        for (box, _) in near {
            let n = InfoSelection.frame(box).vector(V3(0, 0, 1)), side: Float = simd_dot(eye - box.center, n) >= 0 ? 1 : -1
            var beyond = box.center - n*(side*depth); beyond.y = eye.y
            if let z = sem.rooms.first(where: { $0.contains(beyond) })?.id, z != inZone { return Location(inZone: inZone, facing: (z, "near")) }
        }
        return Location(inZone: inZone)
    }
}
