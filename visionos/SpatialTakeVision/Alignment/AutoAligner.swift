import Foundation
import simd

// Lines the scene's layout (space) up with the room the headset sees (world), from the planes ARKit detects, before the user fine-tunes
// it by hand. Both frames are gravity aligned, so the transform is a yaw θ and a translation t: world = R(θ)·space + t.
//
//   height   the floor seen (the largest floor plane) is the zone's floor (semantic rooms[].floorY): t.y = floor seen − floorY.
//   yaw      each wall seen against each wall face of the zone (both faces of every wall slab): the angle between their normals votes,
//            weighted by the seen wall's area; the strongest few angles (2° bins, each refined to the mean of the votes within 2°)
//            are tried.
//   position for a tried yaw, any two seen walls that are not parallel, each taken as one of the zone's faces facing the same way,
//            fix t.x, t.z (each wall: its normal · t is known). Every such t is scored by how well everything seen fits:
//              walls   area × closeness to a face facing the same way (Gaussian, 8 cm), the seen centre within the face's length
//              tables  area × 1.5 when a seen table plane sits at a layout table's top height (8 cm) inside its footprint (15 cm)
//                      (desks, counters and tables are rulers: known heights and extents)
//              doors   1 when a seen door is within 40 cm of a layout door
//            The best one is refined over the walls that fit it (within 15 cm): the yaw by their normals' mean turn, then t by least
//            squares; twice.
// The zone (where the user is) limits the walls tried; without one, every wall of the scene is. The best few distinct candidates go on
// to ICPRefiner, which fits the room's mesh to the scan from each and keeps the one most of it lands on.

struct PlaneObservation {
    enum Kind { case wall, floor, ceiling, table, seat, door, window, other }
    let center: V3, normal: V3, width: Float, height: Float, kind: Kind
    var area: Float { width*height }
    var vertical: Bool { abs(normal.y) < 0.3 }
    var horizontal: Bool { abs(normal.y) > 0.9 }
}

struct AlignmentResult {
    let worldFromSpace: simd_float4x4
    let score: Float, coverage: Float          // matched weight, and its share of all that was seen
    let walls: Int, tables: Int, doors: Int     // how many of each fit
    var others: [simd_float4x4] = []            // the next best distinct ones (unrefined), for ICPRefiner to try too
    var summary: String { String(format: "%d walls, %d tables, %d doors fit · %.0f%% of what was seen", walls, tables, doors, coverage*100) }
}

enum AutoAligner {
    struct Face { let center: V3; let normal: V3; let along: V3; let length: Float; let bottom: Float; let top: Float }
    struct Top { let center: V3; let half: V2; let yaw: Float }

    static func faces(_ sem: Semantic, zone: String?) -> [Face] {
        sem.walls.filter { zone == nil || ($0.rooms ?? []).contains(zone!) }.flatMap { w -> [Face] in
            let n = simd_float4x4(yaw: radians(Float(w.yaw ?? 0)), translation: .zero).vector(V3(0, 0, 1)), c = V3(w.center), half = Float(w.size[2])/2
            let bottom = c.y - Float(w.size[1])/2, top = c.y + Float(w.size[1])/2
            return [1, -1].map { (s: Float) in
                let fn = n*s
                return Face(center: c + fn*half, normal: fn, along: simd_cross(worldUp, fn).normalized, length: Float(w.size[0]), bottom: bottom, top: top)
            }
        }
    }
    static let rulerPattern = try! NSRegularExpression(pattern: "table|desk|counter|tabletop|base", options: .caseInsensitive)
    static func tops(_ sem: Semantic, zone: String?) -> [Top] {
        sem.objects.compactMap { o in
            guard let c = o.center, let s = o.size, zone == nil || o.room == zone else { return nil }
            let text = (o.label ?? "") + " " + (o.category ?? "")
            guard rulerPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil else { return nil }
            return Top(center: V3(Float(c[0]), Float(c[1] + s[1]/2), Float(c[2])), half: V2(Float(s[0])/2, Float(s[2])/2), yaw: radians(Float(o.yaw ?? 0)))
        }
    }
    static func doors(_ sem: Semantic) -> [V3] {
        sem.openings.compactMap { o in (o.category ?? o.label ?? "").lowercased().contains("door") ? o.center.map(V3.init) : nil }
    }

    static func align(_ planes: [PlaneObservation], semantic: Semantic, zone: String?) -> AlignmentResult? {
        let floors = planes.filter { $0.horizontal && ($0.kind == .floor || $0.normal.y > 0) && $0.area > 0.5 }
        guard let floor = floors.filter({ $0.kind == .floor }).max(by: { $0.area < $1.area }) ?? floors.min(by: { $0.center.y < $1.center.y }) else { return nil }
        let zoneFloors = semantic.rooms.filter { zone == nil || $0.id == zone }.compactMap { $0.floorY.map(Float.init) }
        guard !zoneFloors.isEmpty else { return nil }
        let ty = floor.center.y - zoneFloors.sorted()[zoneFloors.count/2]
        let walls = planes.filter { $0.vertical && $0.area > 0.4 && $0.kind != .door && $0.kind != .window }
        let faces = faces(semantic, zone: zone), tops = tops(semantic, zone: zone), doors = doors(semantic)
        guard walls.count >= 2, !faces.isEmpty else { return nil }
        let seenDoors = planes.filter { $0.kind == .door }, seenTables = planes.filter { $0.horizontal && $0.kind != .floor && $0.kind != .ceiling && $0.area > 0.15 }

        // Yaw votes.
        var bins = [Float](repeating: 0, count: 180)
        for w in walls { for f in faces {
            let θ = wrapAngle(yawOf(w.normal) - yawOf(f.normal)), b = Int((degrees(θ) + 180)/2) % 180
            bins[b] += w.area
        } }
        var yaws: [Float] = []
        for b in bins.indices.sorted(by: { bins[$0] > bins[$1] }) where bins[b] > 0 {
            // The bin's centre, refined to the area-weighted mean of the pairs within 2° of it (a long wall makes a degree matter).
            let peak = radians(Float(b*2) - 180 + 1)
            var sum: Float = 0, weight: Float = 0
            for w in walls { for f in faces {
                let d = wrapAngle(yawOf(w.normal) - yawOf(f.normal) - peak)
                if abs(d) < radians(2) { sum += w.area*d; weight += w.area }
            } }
            let θ = wrapAngle(peak + (weight > 0 ? sum/weight : 0))
            if yaws.allSatisfy({ abs(wrapAngle($0 - θ)) > radians(4) }) { yaws.append(θ) }
            if yaws.count == 6 { break }
        }

        var best: (t: V3, θ: Float, score: Float)? = nil, tried: [(t: V3, θ: Float, score: Float)] = []
        for θ in yaws {
            let R = simd_float4x4(yaw: θ, translation: .zero)
            let wf = faces.map { Face(center: R.vector($0.center), normal: R.vector($0.normal), along: R.vector($0.along), length: $0.length, bottom: $0.bottom + ty, top: $0.top + ty) }
            // Each seen wall's candidate faces: facing the same way (10°).
            let pairs: [[Int]] = walls.map { w in wf.indices.filter { simd_dot(wf[$0].normal, w.normal) > cos(radians(10)) } }
            for i in walls.indices { for j in (i+1)..<walls.count where abs(simd_cross(walls[i].normal, walls[j].normal).y) > 0.5 {
                for a in pairs[i] { for b in pairs[j] {
                    let n1 = wf[a].normal.xz, n2 = wf[b].normal.xz
                    let b1 = simd_dot(wf[a].normal, walls[i].center - wf[a].center), b2 = simd_dot(wf[b].normal, walls[j].center - wf[b].center)
                    let det = n1.x*n2.y - n1.y*n2.x
                    guard abs(det) > 0.3 else { continue }
                    let t = V3((b1*n2.y - b2*n1.y)/det, ty, (n1.x*b2 - n2.x*b1)/det)
                    let s = score(t: t, faces: wf, pairs: pairs, walls: walls, R: R, tops: tops, tables: seenTables, doors: doors, seenDoors: seenDoors).score
                    tried.append((t, θ, s))
                    if best == nil || s > best!.score { best = (t, θ, s) }
                } }
            } }
        }
        guard var b = best else { return nil }
        // Refine over the walls that fit (within 15 cm): the yaw by their normals' mean turn (area weighted), then t by least squares
        // on n·t = b; twice.
        let world = { (θ: Float) -> [Face] in
            let R = simd_float4x4(yaw: θ, translation: .zero)
            return faces.map { Face(center: R.vector($0.center), normal: R.vector($0.normal), along: R.vector($0.along), length: $0.length, bottom: $0.bottom + ty, top: $0.top + ty) }
        }
        let matching = { (wf: [Face]) -> [[Int]] in walls.map { w in wf.indices.filter { simd_dot(wf[$0].normal, w.normal) > cos(radians(10)) } } }
        for _ in 0..<2 {
            var wf = world(b.θ), pairs = matching(wf), turn: Float = 0, weight: Float = 0
            for (i, w) in walls.enumerated() {
                guard let f = pairs[i].map({ wf[$0] }).min(by: { abs(residual(w, $0, b.t)) < abs(residual(w, $1, b.t)) }), abs(residual(w, f, b.t)) < 0.15 else { continue }
                turn += w.area*wrapAngle(yawOf(w.normal) - yawOf(f.normal)); weight += w.area
            }
            if weight > 0 { b.θ = wrapAngle(b.θ + turn/weight) }
            wf = world(b.θ); pairs = matching(wf)
            var A = simd_float2x2(), y = V2.zero
            for (i, w) in walls.enumerated() {
                guard let f = pairs[i].map({ wf[$0] }).min(by: { abs(residual(w, $0, b.t)) < abs(residual(w, $1, b.t)) }), abs(residual(w, f, b.t)) < 0.15 else { continue }
                let n = f.normal.xz, rhs = simd_dot(f.normal, w.center - f.center)
                A += w.area*simd_float2x2(rows: [n*n.x, n*n.y]); y += w.area*n*rhs
            }
            if abs(A.determinant) > 1e-4 { let t = A.inverse*y; b.t = V3(t.x, ty, t.y) }
        }
        let R = simd_float4x4(yaw: b.θ, translation: .zero), wf = world(b.θ), pairs = matching(wf)
        let final = score(t: b.t, faces: wf, pairs: pairs, walls: walls, R: R, tops: tops, tables: seenTables, doors: doors, seenDoors: seenDoors)
        let seen = walls.reduce(0) { $0 + $1.area } + seenTables.reduce(0) { $0 + $1.area*1.5 } + Float(seenDoors.count)
        // The runners-up: distinct from the best and each other (30 cm or 5° apart), at least a third of its score.
        var others: [(t: V3, θ: Float, score: Float)] = []
        for c in tried.sorted(by: { $0.score > $1.score }) where c.score >= final.score/3 {
            let distinct = { (o: (t: V3, θ: Float, score: Float)) in simd_distance(o.t, c.t) > 0.3 || abs(wrapAngle(o.θ - c.θ)) > radians(5) }
            if distinct(b), others.allSatisfy(distinct) { others.append(c) }
            if others.count == 4 { break }
        }
        return AlignmentResult(worldFromSpace: simd_float4x4(yaw: b.θ, translation: b.t), score: final.score, coverage: seen > 0 ? min(1, final.score/seen) : 0,
                               walls: final.walls, tables: final.tables, doors: final.doors, others: others.map { simd_float4x4(yaw: $0.θ, translation: $0.t) })
    }

    static func residual(_ w: PlaneObservation, _ f: Face, _ t: V3) -> Float { simd_dot(f.normal, w.center - (f.center + t)) }

    static func score(t: V3, faces wf: [Face], pairs: [[Int]], walls: [PlaneObservation], R: simd_float4x4, tops: [Top], tables: [PlaneObservation], doors: [V3], seenDoors: [PlaneObservation]) -> (score: Float, walls: Int, tables: Int, doors: Int) {
        var s: Float = 0, nw = 0, nt = 0, nd = 0
        for (i, w) in walls.enumerated() {
            var fit: Float = 0
            for k in pairs[i] {
                let f = wf[k], r = residual(w, f, t), along = simd_dot(w.center - (f.center + t), f.along)
                guard abs(along) <= f.length/2 + 0.3, w.center.y > f.bottom - 0.3, w.center.y < f.top + 0.3 else { continue }
                fit = max(fit, exp(-r*r/(2*0.08*0.08)))
            }
            s += w.area*fit; if fit > 0.5 { nw += 1 }
        }
        for p in tables {
            let hit = tops.contains { top in
                let c = R.point(top.center) + t
                guard abs(p.center.y - c.y) < 0.08 else { return false }
                let d = p.center - c, a = top.yaw + (atan2(R.columns.2.x, R.columns.2.z))
                let lx = abs(d.x*cos(a) - d.z*sin(a)), lz = abs(d.x*sin(a) + d.z*cos(a))
                return lx <= top.half.x + 0.15 && lz <= top.half.y + 0.15
            }
            if hit { s += p.area*1.5; nt += 1 }
        }
        for d in seenDoors where doors.contains(where: { simd_distance((R.point($0) + t).xz, d.center.xz) < 0.4 }) { s += 1; nd += 1 }
        return (s, nw, nt, nd)
    }
}
