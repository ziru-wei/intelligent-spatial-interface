import Foundation
import simd

// A scene of the web editor, as visionos/tools/export-space.mjs and bake_surface_colors.py write it into SpaceData/<space>/:
//   semantic.json  the layout (zones, walls, furniture, openings), in space coordinates
//   surfaces.json  the surfaces answer text may go on (the editor's own buildTextTargets): each a planar outline with its frame
//   colors.json + colors/*.png  the scan's colours over each surface (a grid; transparent where the scan has nothing)

struct Semantic: Decodable {
    /// A zone: its floor's outline (polygons of rings of [x, z]) and an info key when it carries one (scripts/info_context.py).
    struct Room: Decodable {
        let id: String; let name: String?; let floorY: Double?; let center: [Double]?; let polygon: [[[[Double]]]]?; let info: String?
        /// Whether a point (space) stands inside the zone's outline (any of its polygons, outside their holes).
        func contains(_ p: V3) -> Bool {
            func inside(_ ring: [[Double]]) -> Bool {
                var c = false, j = ring.count - 1
                for i in ring.indices {
                    let (xi, zi, xj, zj) = (ring[i][0], ring[i][1], ring[j][0], ring[j][1])
                    if (zi > Double(p.z)) != (zj > Double(p.z)), Double(p.x) < (xj - xi)*(Double(p.z) - zi)/(zj - zi) + xi { c.toggle() }
                    j = i
                }
                return c
            }
            return (polygon ?? []).contains { rings in rings.first.map(inside) == true && !rings.dropFirst().contains(where: inside) }
        }
    }
    struct Wall: Decodable { let id: String; let center: [Double]; let size: [Double]; let yaw: Double?; let rooms: [String]?; let outline: [[Double]]? }
    /// Furniture or an opening; `info`: the info key it carries (the editor's Layout section).
    struct Box: Decodable {
        let id: String; let label: String?; let category: String?; let center: [Double]?; let size: [Double]?; let yaw: Double?; let room: String?; let parent: String?; let info: String?
        /// Its shape when not a box (the editor's: a cylinder, for a round table).
        struct Shape: Decodable { let type: String? }
        let shape: Shape?
        var round: Bool { shape?.type == "cylinder" }
    }
    /// A scene object of the live session carrying info (the candy): comp:<id>, a box (export-space.mjs infoObjects).
    struct InfoObject: Decodable { let id: String; let label: String?; let center: [Double]; let size: [Double]; let yaw: Double?; let info: String }
    let rooms: [Room]
    let walls: [Wall]
    let objects: [Box]
    let openings: [Box]
    let infoObjects: [InfoObject]?
}

struct SurfaceRecord: Decodable {
    let id: String, kind: String
    let surface: String?, room: String?, objectId: String?, label: String?
    let opening: Bool, frontOnly: Bool
    let origin: [Double], normal: [Double], right: [Double], up: [Double]
    let width: Double, height: Double
    let triangles: [Double]
}
private struct SurfaceFile: Decodable { let space: String; let scan: String?; let surfaces: [SurfaceRecord] }
private struct ColorIndex: Decodable {
    struct Entry: Decodable { let file: String; let cell: Double; let columns: Int; let rows: Int; let coverage: Double }
    let files: [String: Entry]
}

/// A surface text may go on: a planar outline (triangles, in its own plane: metres along right and up from its origin).
final class Surface {
    let id: String, kind: String, wallLike: Bool, room: String?, objectId: String?, label: String?, frontOnly: Bool
    let family: String?     // what it is part of: wall, box (furniture or an opening's frame) or floor; nil for windows and ceilings
    let opening: Bool       // a door's or window's box
    let origin: V3, normal: V3, right: V3, up: V3
    let width: Float, height: Float
    let triangles: [(V2, V2, V2)]
    let colors: ColorGrid?
    init(_ r: SurfaceRecord, colors: ColorGrid?) {
        id = r.id; kind = r.kind; wallLike = r.surface == "wall"; family = r.surface; opening = r.opening; room = r.room; objectId = r.objectId; label = r.label; frontOnly = r.frontOnly
        origin = V3(r.origin); normal = V3(r.normal).normalized; right = V3(r.right).normalized; up = V3(r.up).normalized
        width = Float(r.width); height = Float(r.height)
        var tris: [(V2, V2, V2)] = []
        let t = r.triangles.map(Float.init)
        var i = 0
        while i + 5 < t.count { tris.append((V2(t[i], t[i+1]), V2(t[i+2], t[i+3]), V2(t[i+4], t[i+5]))); i += 6 }
        triangles = tris; self.colors = colors
    }
    /// A point (space) in this surface's own plane coordinates.
    func local(_ p: V3) -> V2 { let d = p - origin; return V2(simd_dot(d, right), simd_dot(d, up)) }
    func point(_ l: V2) -> V3 { origin + right*l.x + up*l.y }
    func contains(_ l: V2) -> Bool {
        if triangles.isEmpty { return abs(l.x) <= width/2 && abs(l.y) <= height/2 }
        for (a, b, c) in triangles {
            let cross = { (p: V2, q: V2) in (q.x-p.x)*(l.y-p.y) - (q.y-p.y)*(l.x-p.x) }
            let u = cross(a, b), v = cross(b, c), w = cross(c, a)
            if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) || (u <= 1e-6 && v <= 1e-6 && w <= 1e-6) { return true }
        }
        return false
    }
    func contains(_ p: V3) -> Bool { contains(local(p)) }
}

final class SpaceData {
    let name: String
    let scanLabel: String?
    let semantic: Semantic
    let surfaces: [Surface]

    /// Loads SpaceData/<name> from the app bundle.
    convenience init(named name: String, bundle: Bundle = .main) throws {
        guard let dir = bundle.url(forResource: name, withExtension: nil, subdirectory: "SpaceData") else {
            throw NSError(domain: "SpaceData", code: 1, userInfo: [NSLocalizedDescriptionKey: "No SpaceData/\(name) in the app."])
        }
        try self.init(directory: dir)
    }

    convenience init(directory dir: URL) throws {
        try self.init(name: dir.lastPathComponent, semantic: Data(contentsOf: dir.appending(path: "semantic.json")),
                      surfaces: Data(contentsOf: dir.appending(path: "surfaces.json")), colors: try? Data(contentsOf: dir.appending(path: "colors.json")),
                      colorDir: dir.appending(path: "colors"))
    }

    /// From the files' contents: semantic.json, surfaces.json ({space, scan, surfaces}), colors.json ({files}) with its PNGs in colorDir.
    init(name: String, semantic semanticData: Data, surfaces surfacesData: Data, colors colorsData: Data?, colorDir: URL) throws {
        let decoder = JSONDecoder()
        self.name = name
        semantic = try decoder.decode(Semantic.self, from: semanticData)
        let file = try decoder.decode(SurfaceFile.self, from: surfacesData)
        scanLabel = file.scan
        let index = colorsData.flatMap { try? decoder.decode(ColorIndex.self, from: $0) }?.files ?? [:]
        surfaces = file.surfaces.map { r in
            let colors = index[r.id].flatMap { e in
                ColorGrid(url: colorDir.appending(path: e.file), cell: Float(e.cell), width: Float(r.width), height: Float(r.height))
            }
            return Surface(r, colors: colors)
        }
    }

    /// The zones (rooms), with a floor height, by name.
    var zones: [Semantic.Room] { semantic.rooms.filter { $0.floorY != nil } }
}
