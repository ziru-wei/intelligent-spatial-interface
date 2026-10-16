import Foundation
import simd

// Where an answer goes, ported from the web editor's surface search (src/text-surfaces.mjs staticTextPlacement, with the readable
// basis of src/placement.mjs). Everything here is in space coordinates.
//
// Candidate spots: on each surface facing the eye (frontOnly surfaces only from their front), a 7 × 7 grid over it plus where rays
// across the field of view meet it. At each, the text is set upright on walls and box sides (up = gravity in the face) and, on
// horizontal surfaces, reading away from the viewer; its width is what makes the body's x-height subtend `targetDeg` at the eye
// (× bodySize), then 0.85, 0.7, 0.55 of that. A spot must keep 75% of the text on its surface, all of it within the comfortable
// field of view, and the x-height at least minDeg. Cost, lowest wins (the web's terms):
//   8 × clutter (the scan's colours behind it: ColorGrid; surface-quality cost 4 × clutter, doubled as the web does near a target)
//   + 1.2 × tilt on screen + 6 × metres above the eye (beyond 10 cm) + metres below (beyond 60 cm) + 0.15 × |log scale|
//   + 0.35 × how far from the view's centre + 0.03 × distance
//   − 0.5 on the surface the person relates to (SpatialRelations: A the desk under the gaze, B the wall faced, D what the gaze is on);
//     on a faced wall (B) it also wants the text near eye level (0.8 × |height − (eye − 10 cm)|).
// An answer goes on the relation's surface when it holds one (the web's step 2), else wherever in the room is best, else floats.
// The scan's clutter where it saw nothing counts as UNSEEN_CLUTTER (moderately busy: unknown is not clean).
// The cheapest spots are then checked against the room as the headset sees it now (DepthProbe: its own scene mesh, as the web uses the
// recorded depth, src/surface-quality.mjs): how far in front of the text's plane the real room is, over the text, less the surface's
// own offset from the mesh (its median over the surface: the alignment's error, as the web calibrates its surfaces). Hidden (more than
// 12 cm in front) at more than 20% of it: out. Otherwise its roughness (the 15th-85th percentile spread, over 10 cm) and how occupied
// it is (things standing on or before the surface: each point 3-9 cm in front, 0-1) join the clutter in the web's quality cost,
// 4 clutter + 2 roughness + 4 occupied, which costs (near ? 3 : 2) × that; the spots are ranked again with it.

/// For points (space): how far in front of each the real room is along the ray from the eye (metres; negative: behind it), nil where
/// the room's mesh has nothing (or there is no mesh).
typealias DepthProbe = ([V3]) -> [Float?]

struct TextMetrics {
    var aspect: Float          // height / width of the text's panel
    var xHeightRatio: Float    // the body's x-height / the panel's width
    var scale: Float = 1       // body size (Behavior)
}

struct HeadPose {
    let eye: V3, forward: V3, up: V3, right: V3   // space coordinates
    init(spaceFromHead m: simd_float4x4) {
        eye = m.translation; forward = (-m.zAxis).normalized; up = m.yAxis.normalized; right = m.xAxis.normalized
    }
}

struct PlacedText {
    let surface: Surface
    let center: V3              // the panel's centre, lifted off the surface (space)
    let right: V3, up: V3, normal: V3
    let width: Float, height: Float
    let style: TextStyle
    let cost: Float
    var clutter: Float = 0             // the scan's clutter behind it (0 plain … 1 busy)
    var quality: Float = 0             // the web's surface-quality cost: 4 clutter + 2 roughness + 4 occupied (0 … 10): the info score's "clean"
    var settled = false                // an info answer settled on a surface (it stays, and its look is fixed)
    var transform: simd_float4x4 { simd_float4x4(right: right, up: up, normal: normal, origin: center) }
}

enum TextPlacement {
    static let unseenClutter: Float = 0.4, hiddenBy: Float = 0.12
    /// What answer text must keep clear of in the view (a zone's animation playing): no spot whose text the eye would see over or behind it.
    static var keepClear: [InfoTarget] = []
    static func covers(_ points: [V3], eye: V3) -> Bool {
        !keepClear.isEmpty && points.contains { p in keepClear.contains { InfoSelection.rayHitsBox(eye, p - eye, $0) } }
    }
    /// Whether a placed text would hide (or be seen over) what must stay clear.
    static func covers(_ p: PlacedText, eye: V3) -> Bool {
        covers([(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (0, 0)].map { (x: Float, y: Float) in p.center + p.right*(x*p.width) + p.up*(y*p.height) }, eye: eye)
    }
    /// A floating panel moved aside (along its right, either way, further each time) until it keeps clear of `keepClear`.
    static func clear(_ p: PlacedText, eye: V3) -> PlacedText {
        func corners(_ c: V3) -> [V3] { [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (0, 0)].map { (x: Float, y: Float) in c + p.right*(x*p.width) + p.up*(y*p.height) } }
        guard covers(corners(p.center), eye: eye) else { return p }
        for d in stride(from: Float(0.15), through: 1.5, by: 0.15) { for sign: Float in [1, -1] {
            let c = p.center + p.right*(sign*d)
            if !covers(corners(c), eye: eye) { return PlacedText(surface: p.surface, center: c, right: p.right, up: p.up, normal: p.normal, width: p.width, height: p.height, style: p.style, cost: p.cost, clutter: p.clutter, quality: p.quality, settled: p.settled) }
        } }
        return p
    }
    static let targetDeg: Float = 0.45, minDeg: Float = 0.3, halfFieldH: Float = 26, halfFieldV: Float = 19, lift: Float = 0.018, reach: Float = 6

    /// The surface the gaze meets first (within reach), facing the eye.
    static func gazed(_ surfaces: [Surface], head: HeadPose) -> Surface? {
        var best: (Surface, Float)? = nil
        for s in surfaces where s.kind != "ceiling" {
            let den = simd_dot(head.forward, s.normal)
            guard abs(den) > 1e-4 else { continue }
            let t = simd_dot(s.origin - head.eye, s.normal)/den
            guard t > 0.05, t < reach, best == nil || t < best!.1 else { continue }
            if s.frontOnly && simd_dot(s.normal, head.eye - s.origin) < 0 { continue }
            if s.contains(head.eye + head.forward*t) { best = (s, t) }
        }
        return best?.0
    }

    /// Text basis on a surface: upright on walls and sides, reading away from the eye on horizontal surfaces.
    static func basis(normal n: V3, at p: V3, eye: V3) -> (right: V3, up: V3)? {
        var up: V3
        if abs(n.y) < 0.7 { up = worldUp - n*simd_dot(worldUp, n) }
        else { let away = p - eye; up = away - n*simd_dot(away, n) }
        guard up.length > 1e-5 else { return nil }
        up = up.normalized
        return (simd_cross(up, n).normalized, up)
    }

    /// Angles (degrees) of a point off the view's centre, horizontally and vertically; nil behind the eye.
    static func viewAngles(_ p: V3, head: HeadPose) -> V2? {
        let d = p - head.eye, z = simd_dot(d, head.forward)
        guard z > 0.05 else { return nil }
        return V2(degrees(atan(simd_dot(d, head.right)/z)), degrees(atan(simd_dot(d, head.up)/z)))
    }

    /// The angle (degrees) the body's x-height subtends at the eye, for text of this width at p with this up.
    static func xHeightDeg(width: Float, metrics: TextMetrics, at p: V3, up: V3, eye: V3) -> Float {
        let toP = p - eye, d = toP.length, dir = toP/d, perp = (up - dir*simd_dot(up, dir)).length
        return degrees(atan(width*metrics.xHeightRatio*perp/d))
    }

    static func place(in surfaces: [Surface], head: HeadPose, metrics: TextMetrics, relation: SpatialRelation?, probe: DepthProbe) -> PlacedText? {
        var o = SearchOptions(); o.prefer = relation?.surface; o.eyeLevel = relation?.relation == .B
        if let r = relation {
            var only = o; only.only = { $0 === r.surface }
            if let p = search(in: surfaces, head: head, metrics: metrics, probe: probe, options: only).first { return p }
        }
        return search(in: surfaces, head: head, metrics: metrics, probe: probe, options: o).first
    }

    /// What a search may do beyond the defaults (the web's response.near, avoid, candidates, minShrink, overflow, overhang,
    /// preferSurfaceId: an info answer's search, src/placement.mjs infoPlacement).
    struct SearchOptions {
        /// Spots near this point only (within `max`), every 10 cm around it too, costing 0.6 × their distance from it; none whose text
        /// would cover `avoid` (the box itself).
        var near: (point: V3, max: Float, avoid: (V3) -> Bool)? = nil
        var minShrink: Float = 0.55          // the smallest size, against the size wanted
        var overflow: Float = 0              // the share of the text that may lie outside the comfortable field of view
        var onSurface: Float = 0.75          // the share of the text that must lie on its surface
        var prefer: Surface? = nil           // the surface the person relates to (SpatialRelations): 0.5 cheaper
        var eyeLevel = false                 // the relation is B (a faced wall): near eye level on it
        var only: ((Surface) -> Bool)? = nil // only these surfaces
        var field: Float = 1                 // the comfortable field of view, scaled (the weather's text may sit wider)
        var minFacing: Float = 0             // the text must face the eye at least this much (cos of the angle off square, at the spot)
        var results = 1                      // how many spots to return (20 cm apart; the preferred surface's best always among them)
    }

    /// The best spots, cheapest first (each checked against the room: 80% of it unhidden).
    static func search(in surfaces: [Surface], head: HeadPose, metrics: TextMetrics, probe: DepthProbe, options o: SearchOptions) -> [PlacedText] {
        let prefer = o.prefer
        let shrinks = Array(Set([1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25].filter { $0 >= o.minShrink - 1e-6 } + [o.minShrink])).sorted(by: >)
        var candidates: [(cost: Float, surface: Surface, contact: V3, n: V3, right: V3, up: V3, width: Float, clutter: Float)] = []
        for s in surfaces where s.kind != "ceiling" {
            if let only = o.only, !only(s) { continue }
            var n = s.normal
            let toward = head.eye - s.origin
            if simd_dot(n, toward) < 0 { if s.frontOnly { continue }; n = -n }
            if simd_dot(n, toward.normalized) < 0.25 { continue }
            if toward.length - max(s.width, s.height)/2 > reach { continue }
            if let near = o.near {   // the surface's rectangle within reach of the point
                let l = s.local(near.point), dx = max(0, abs(l.x) - s.width/2), dy = max(0, abs(l.y) - s.height/2), dz = simd_dot(near.point - s.origin, s.normal)
                if (dx*dx + dy*dy + dz*dz).squareRoot() > near.max { continue }
            }
            var centers: [V3] = []
            for y in -3...3 { for x in -3...3 {
                let l = V2(Float(x)*s.width/7, Float(y)*s.height/7)
                if s.contains(l) { centers.append(s.point(l)) }
            } }
            if let near = o.near {   // every 10 cm around the point, on this surface
                let c = s.local(near.point)
                for y in stride(from: -near.max, through: near.max, by: 0.1) { for x in stride(from: -near.max, through: near.max, by: 0.1) where (x*x + y*y).squareRoot() <= near.max {
                    let l = c + V2(x, y); if s.contains(l) { centers.append(s.point(l)) }
                } }
            }
            for h in stride(from: -0.4 as Float, through: 0.4, by: 0.2) { for v in stride(from: -0.3 as Float, through: 0.3, by: 0.15) {
                let dir = (head.forward + head.right*h + head.up*v).normalized, den = simd_dot(dir, n)
                guard abs(den) > 1e-4 else { continue }
                let t = simd_dot(s.origin - head.eye, n)/den
                guard t > 0.1, t < reach else { continue }
                let p = head.eye + dir*t
                if s.contains(p) { centers.append(p) }
            } }
            for contact in centers {
                if let near = o.near, simd_distance(contact, near.point) > near.max { continue }
                if o.minFacing > 0, simd_dot(n, (head.eye - contact).normalized) < o.minFacing { continue }
                guard let b = basis(normal: n, at: contact, eye: head.eye), let angles = viewAngles(contact, head: head),
                      abs(angles.x) < halfFieldH*o.field, abs(angles.y) < halfFieldV*o.field else { continue }
                let unit = xHeightDeg(width: 1, metrics: metrics, at: contact, up: b.up, eye: head.eye)
                guard unit > 1e-4 else { continue }
                let wanted = targetDeg*metrics.scale/unit
                for k in shrinks {
                    let width = wanted*k, height = width*metrics.aspect
                    guard xHeightDeg(width: width, metrics: metrics, at: contact, up: b.up, eye: head.eye) >= minDeg*metrics.scale*0.9 else { continue }
                    // On its surface (an 8 × 4 grid over the panel), in the comfortable field of view (all of it, or all but
                    // `overflow`), and not over the box it is about.
                    var inside = 0, inView = 0, covers = false
                    for j in 0...3 { for i in 0...7 {
                        let p = contact + b.right*((Float(i)/7 - 0.5)*width) + b.up*((Float(j)/3 - 0.5)*height)
                        if s.contains(p) { inside += 1 }
                        if let a = viewAngles(p, head: head), abs(a.x) <= halfFieldH*o.field, abs(a.y) <= halfFieldV*o.field { inView += 1 }
                        if let near = o.near, near.avoid(p + n*lift) { covers = true }
                    } }
                    guard !covers, Float(inView)/32 >= 1 - o.overflow - 1e-6, Float(inside)/32 >= o.onSurface else { continue }
                    let local = s.local(contact)
                    let region = s.colors?.region(x0: local.x - width/2, x1: local.x + width/2, y0: local.y - height/2, y1: local.y + height/2, limit: 200)
                    let clutter = region.map { $0.share*Legibility.clutter($0.features) + (1 - $0.share)*unseenClutter } ?? unseenClutter
                    let position = contact + n*lift, above = max(0, position.y - head.eye.y - 0.1), below = max(0, head.eye.y - 0.6 - position.y)
                    let sr = V2(simd_dot(b.right, head.right), simd_dot(b.right, head.up)), tilt0 = abs(atan2(sr.y, sr.x)), tilt = min(tilt0, Float.pi - tilt0)
                    let off: Float = simd_length(V2(tan(radians(angles.x)), tan(radians(angles.y))))
                    var cost: Float = (o.near != nil ? 12 : 8)*clutter + 1.2*tilt
                    cost += 6*above + below
                    cost += 0.15*abs(log(k)) + 0.35*off + 0.03*toward.length
                    if let near = o.near { cost += 0.6*simd_distance(contact, near.point) }
                    if prefer === s { cost -= 0.5; if o.eyeLevel && abs(n.y) < 0.7 { cost += 0.8*abs(contact.y - (head.eye.y - 0.1)) } }
                    candidates.append((cost, s, contact, n, b.right, b.up, width, clutter))
                }
            }
        }
        candidates.sort { $0.cost < $1.cost }
        // Checked against the room now (see above), then ranked again.
        var checked: [(cost: Float, c: (cost: Float, surface: Surface, contact: V3, n: V3, right: V3, up: V3, width: Float, clutter: Float), quality: Float)] = []
        var taken = Set<String>(), tried = 0
        // Each surface's own offset from the room's mesh first (the web calibrates its surfaces against the recorded depth the same way):
        // the median of how far in front of it the mesh is over a grid on it. The alignment is off by a few centimetres, and that would
        // otherwise read as the whole surface being occupied.
        var offsets: [ObjectIdentifier: Float] = [:]
        func offset(_ s: Surface, _ n: V3) -> Float {
            if let o = offsets[ObjectIdentifier(s)] { return o }
            var pts: [V3] = []
            for y in -3...3 { for x in -3...3 { let l = V2(Float(x)*s.width/7, Float(y)*s.height/7); if s.contains(l) { pts.append(s.point(l)) } } }
            let r = probe(pts).compactMap { $0 }.sorted()
            let o = r.count >= 5 ? max(-0.15, min(0.15, r[r.count/2])) : 0
            offsets[ObjectIdentifier(s)] = o
            return o
        }
        for c in candidates {
            if tried >= (o.results > 1 ? 80 : 24) { break }
            let key = "\(c.surface.id)|\(Int((c.contact.x*5).rounded())),\(Int((c.contact.y*5).rounded())),\(Int((c.contact.z*5).rounded()))"
            if taken.contains(key) { continue }
            taken.insert(key); tried += 1
            let height = c.width*metrics.aspect
            var footprint: [V3] = []
            for j in 0...3 { for i in 0...7 { footprint.append(c.contact + c.right*((Float(i)/7 - 0.5)*c.width) + c.up*((Float(j)/3 - 0.5)*height)) } }
            if covers(footprint, eye: head.eye) { continue }
            let base = offset(c.surface, c.n), r = probe(footprint).map { $0.map { $0 - base } }
            guard !r.isEmpty, Float(r.filter { ($0 ?? -1) > hiddenBy }.count)/Float(r.count) <= 0.2 else { continue }
            let known = r.compactMap { $0 }.sorted()
            let roughness = known.count >= 4 ? min(1, max(0, known[Int(Float(known.count - 1)*0.85)] - known[Int(Float(known.count - 1)*0.15)])/0.10) : 0
            let occupied = known.isEmpty ? 0 : known.reduce(0) { $0 + clamp01(($1 - 0.03)/0.06) }/Float(known.count)
            let quality = 4*c.clutter + 2*roughness + 4*occupied
            checked.append((c.cost + (o.near != nil ? 3 : 2)*(2*roughness + 4*occupied), c, quality))
        }
        checked.sort { $0.cost < $1.cost }
        var picks = Array(checked.prefix(o.results))
        // The preferred surface's best is always among several.
        if o.results > 1, let prefer, !picks.contains(where: { $0.c.surface === prefer }), let best = checked.first(where: { $0.c.surface === prefer }) {
            if picks.count == o.results { picks.removeLast() }
            picks.append(best)
        }
        return picks.map { k in
            let c = k.c, height = c.width*metrics.aspect, center = c.contact + c.n*lift
            let local = c.surface.local(c.contact)
            let region = c.surface.colors?.region(x0: local.x - c.width/2, x1: local.x + c.width/2, y0: local.y - height/2, y1: local.y + height/2)
            // The web's style clutter is a share of strong-edge pixels (0 … ~0.3): the feature mean is on a larger scale.
            let style = Legibility.pick(pixels: region?.pixels ?? [], clutter: 0.4*c.clutter)
            return PlacedText(surface: c.surface, center: center, right: c.right, up: c.up, normal: c.n, width: c.width, height: height, style: style, cost: k.cost, clutter: c.clutter, quality: k.quality)
        }
    }

    /// No surface fits: floating 1.25 m ahead, facing the eye, upright.
    static func floating(head: HeadPose, metrics: TextMetrics) -> PlacedText? {
        var f = head.forward; f.y = 0
        guard f.length > 1e-3 else { return nil }
        f = f.normalized
        let center = head.eye + f*1.25, n = -f, up = worldUp, right = simd_cross(up, n).normalized
        let unit = xHeightDeg(width: 1, metrics: metrics, at: center, up: up, eye: head.eye), width = targetDeg*metrics.scale/max(unit, 1e-4)
        return clear(PlacedText(surface: Surface.none, center: center, right: right, up: up, normal: n, width: width, height: width*metrics.aspect, style: TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0), cost: .infinity), eye: head.eye)
    }
}

extension Surface {
    /// Stands in for "no surface" (floating text).
    static let none = Surface(SurfaceRecord(id: "floating", kind: "none", surface: nil, room: nil, objectId: nil, label: nil, opening: false, frontOnly: false,
                                            origin: [0, 0, 0], normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], width: 0, height: 0, triangles: []), colors: nil)
}
