import Foundation
import simd

// Where an info answer goes, ported from the web editor (src/placement.mjs infoPlacement, infoSpotScore, floatYaw, floatNearBox).
// Space coordinates. Near its box: the surface search's best few spots within INFO_NEAR of the box (never over it; text may be as small
// as the Behavior setting allows, run 25% past the edge of the view and 40% past its surface), ranked by the info score:
//   .1 near (10 cm from the box: 1, 0 at 1 m) + .15 facing (the text turned the way the box shows itself to the viewer: each face by how
//   much the eye sees of it) + .55 clean (the web's surface-quality cost behind it: the scan's clutter, the room mesh's roughness and
//   what stands there) + .1 level (lines level as seen, not far above the eye)
//   + .1 relation (on the surface the person relates to, SpatialRelations, else the one the box rests on: 1, another 0; .5 when
//   there is neither)
// A box resting on a top (the candy on its table) has its answer on that top, always, settled (the score threshold below is for the
// rest: from a little way off, a table offers few spots and the scan's colours on it are busy, and the answer would float off it).
// At INFO_SETTLE or more it settles there and stays (its look fixed). Otherwise it floats beside the box, in the box's own plane (turned
// like the box's face toward the viewer when that face is within `parallel` degrees of facing them, else toward them), on the side or
// corner that fits the view best, as large as fits.

enum InfoPlacement {
    static let near: Float = 1, settle: Float = 0.7
    static let float = (gap: Float(0.04), maxWidth: Float(1.2), moveAbove: Float(0.3))

    struct Spot { let near, facing, clean, level, relation, score: Float }

    static func score(_ p: PlacedText, box t: InfoTarget, head: HeadPose, relation: Surface?) -> Spot {
        let inv = InfoSelection.frame(t).inverse, h = t.size/2, l = inv.point(p.center)
        let near = ramp(simd_length(simd_max(abs(l) - h, .zero)), 0.1, 1)
        // The faces the eye sees, each by facing × area; the text's facing against them.
        let toEye = inv.vector(head.eye - t.center).normalized, n = inv.vector(p.normal)
        var sum: Float = 0, seen: Float = 0
        for (axis, area) in [(V3(1, 0, 0), h.y*h.z), (V3(0, 1, 0), h.x*h.z), (V3(0, 0, 1), h.x*h.y)] { for s: Float in [1, -1] {
            let w = max(0, simd_dot(axis*s, toEye))*area; if w == 0 { continue }
            seen += w; sum += w*max(0, simd_dot(n, axis*s))
        } }
        let facing = seen > 0 ? sum/seen : 0
        let clean = ramp(p.quality, 0, 4)   // the web's surface-quality cost: 0 → 1, 4 or more → 0
        // Level: the lines' tilt as seen (1 within 4°, 0 at 20°) × not far above the eye (1 up to 10 cm, 0 at 60 cm).
        let sr = V2(simd_dot(p.right, head.right), simd_dot(p.right, head.up)), t0 = abs(atan2(sr.y, sr.x)), tilt = degrees(min(t0, .pi - t0))
        let level = ramp(tilt, 4, 20)*ramp(max(0, p.center.y - head.eye.y - 0.1), 0, 0.5)
        let rel: Float = relation == nil ? 0.5 : p.surface === relation ? 1 : 0
        return Spot(near: near, facing: facing, clean: clean, level: level, relation: rel, score: 0.1*near + 0.15*facing + 0.55*clean + 0.1*level + 0.1*rel)
    }

    /// The answer's place for this box: settled on a surface, else floating beside the box (nil only when nothing fits at all).
    /// only: the surfaces it may settle on (all by default; the weather's text: upright ones, or the table it is on).
    static func place(box t: InfoTarget, surfaces: [Surface], head: HeadPose, metrics: TextMetrics, minShrink: Float, parallel: Float, relation r: SpatialRelation?,
                      only: ((Surface) -> Bool)? = nil, field: Float = 1, overflow: Float = 0.25, minFacing: Float = 0, probe: DepthProbe) -> (PlacedText, Spot?)? {
        // Without a person–space relation, the surface the box itself rests on (the candy's table, the booklet's counter) takes its part.
        let relation = r?.surface ?? support(of: t, in: surfaces)
        let inv = InfoSelection.frame(t).inverse, h = t.size/2 + V3(repeating: 0.02)
        let avoid = { (p: V3) -> Bool in let l = inv.point(p); return abs(l.x) <= h.x && abs(l.y) <= h.y && abs(l.z) <= h.z + 0.03 }
        var o = TextPlacement.SearchOptions()
        o.near = (t.center, near, avoid); o.minShrink = minShrink; o.overflow = overflow; o.field = field; o.minFacing = minFacing; o.onSurface = 0.6; o.prefer = relation; o.eyeLevel = r?.relation == .B; o.only = only; o.results = 8
        // A box resting on a top (the candy on its table): the answer goes on that top, always: the best spot the search finds on it
        // (anywhere in front, near the box and off it) whatever its score, else straight onto its clearest spot by the box; settled.
        if only == nil, let top = support(of: t, in: surfaces) {
            var on = o; on.only = { $0 === top }; on.field = 3; on.overflow = 1; on.minFacing = 0; on.minShrink = min(minShrink, 0.4); on.near = (t.center, 1.2, avoid)
            let found = TextPlacement.search(in: surfaces, head: head, metrics: metrics, probe: probe, options: on)
                .map { ($0, score($0, box: t, head: head, relation: top)) }.max { $0.1.score < $1.1.score }
            if var p = found?.0 ?? WeatherText.onTable(top, avoiding: t, near: t.center, head: head, metrics: metrics) {
                p.settled = true
                return (p, found?.1 ?? score(p, box: t, head: head, relation: top))
            }
        }
        let ranked = TextPlacement.search(in: surfaces, head: head, metrics: metrics, probe: probe, options: o)
            .map { ($0, score($0, box: t, head: head, relation: relation)) }.sorted { $0.1.score > $1.1.score }
        if let best = ranked.first, best.1.score >= settle { var p = best.0; p.settled = true; return (p, best.1) }
        return floatNear(box: t, head: head, metrics: metrics, parallel: parallel, field: field, probe: probe).map { ($0, ranked.first?.1) }
    }

    /// The horizontal surface a box rests on: under its centre, its top within 6 cm below the box's bottom (or 3 cm into it).
    static func support(of t: InfoTarget, in surfaces: [Surface]) -> Surface? {
        let bottom = t.center.y - t.size.y/2
        return surfaces.filter { s in
            s.normal.y > 0.9 && s.origin.y <= bottom + 0.03 && s.origin.y >= bottom - 0.06 && s.contains(V3(t.center.x, s.origin.y, t.center.z))
        }.max { $0.origin.y < $1.origin.y }
    }

    /// The panel's yaw beside the box: parallel to the box's upright face the eye sees most of, when that face is within `parallel`
    /// degrees of turning to the eye; else turned to the eye.
    static func floatYaw(_ t: InfoTarget, at p: V3, eye: V3, parallel: Float) -> Float {
        let toEye = atan2(eye.x - p.x, eye.z - p.z)
        let diff = { (y: Float) -> Float in abs(wrapAngle(y - toEye)) }
        let faces: [(Float, Float)] = [(t.yaw, t.size.x*t.size.y), (t.yaw + .pi, t.size.x*t.size.y), (t.yaw + .pi/2, t.size.z*t.size.y), (t.yaw - .pi/2, t.size.z*t.size.y)]
        let face = faces.max { cos(diff($0.0))*$0.1 < cos(diff($1.0))*$1.1 }!.0
        return diff(face) < radians(parallel) ? face : toEye
    }

    static func floatNear(box t: InfoTarget, head: HeadPose, metrics: TextMetrics, parallel: Float, field: Float = 1, probe: DepthProbe) -> PlacedText? {
        let yaw = floatYaw(t, at: t.center, eye: head.eye, parallel: parallel)
        let n = V3(sin(yaw), 0, cos(yaw)), r = V3(cos(yaw), 0, -sin(yaw))
        // The box's extent in that plane: half sizes along r and up, its depth toward n.
        let bq = simd_float4x4(yaw: t.yaw, translation: .zero); var hr: Float = 0, hn: Float = 0, hu = t.size.y/2
        for sx: Float in [-1, 1] { for sz: Float in [-1, 1] { let c = bq.vector(V3(sx*t.size.x/2, 0, sz*t.size.z/2)); hr = max(hr, abs(simd_dot(c, r))); hn = max(hn, simd_dot(c, n)) } }
        hu = t.size.y/2
        let base = t.center + n*(hn + 0.03), maxWidth = float.maxWidth*metrics.scale
        var cands: [(cost: Float, p: PlacedText)] = []
        for (dx, dy) in [(1, 0), (-1, 0), (0, -1), (0, 1), (1, -1), (-1, -1), (1, 1), (-1, 1)] as [(Float, Float)] { for ring: Float in [0, 1] {
            let unit = TextPlacement.xHeightDeg(width: 1, metrics: metrics, at: base, up: worldUp, eye: head.eye)
            let wanted = min(maxWidth, TextPlacement.targetDeg*metrics.scale/max(unit, 1e-4))
            for shrink: Float in [1, 0.85, 0.7, 0.55, 0.45] {
                let width = wanted*shrink, height = width*metrics.aspect
                let position = base + r*(dx*(hr + float.gap + width/2 + ring*0.15)) + worldUp*(dy*(hu + float.gap + height/2 + ring*0.1))
                var inView = 0
                for j in 0...3 { for i in 0...7 {
                    let p = position + r*((Float(i)/7 - 0.5)*width) + worldUp*((Float(j)/3 - 0.5)*height)
                    if let a = TextPlacement.viewAngles(p, head: head), abs(a.x) <= TextPlacement.halfFieldH*field, abs(a.y) <= TextPlacement.halfFieldV*field { inView += 1 }
                } }
                let coverage = Float(inView)/32, fits = coverage >= 1
                let above = max(0, position.y - head.eye.y - 0.1)
                let cost = 3*(1 - coverage) + (fits ? 0 : 2) + 8*above + 0.3*ring + 0.15*abs(dx*dy) + 0.25*(1 - shrink)
                cands.append((cost, PlacedText(surface: .none, center: position, right: r, up: worldUp, normal: n, width: width, height: height,
                                               style: TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0), cost: cost)))   // no backing: nothing known behind it
                if fits { break }   // the largest size that fits
            }
        } }
        cands.sort { $0.cost < $1.cost }
        var best: (Float, PlacedText)?
        for c in cands.prefix(6) {
            var fp: [V3] = []
            for j in 0...3 { for i in 0...7 { fp.append(c.p.center + c.p.right*((Float(i)/7 - 0.5)*c.p.width) + c.p.up*((Float(j)/3 - 0.5)*c.p.height)) } }
            let seen = probe(fp).map { ($0 ?? -1) <= 0.05 }, share = seen.isEmpty ? 1 : Float(seen.filter { $0 }.count)/Float(seen.count), cost = c.cost + 2*(1 - share)
            if best == nil || cost < best!.0 { best = (cost, c.p) }
        }
        return best.map { TextPlacement.clear($0.1, eye: head.eye) }
    }
}
