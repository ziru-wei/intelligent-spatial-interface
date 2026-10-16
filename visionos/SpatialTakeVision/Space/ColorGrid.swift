import Foundation
import ImageIO
import CoreGraphics

/// The scan's colours over a surface (bake_surface_colors.py): a grid every `cell` metres over its width × height rectangle, row 0 at
/// the top. A cell is unknown (alpha 0) where the scan has nothing. Loaded on first use.
final class ColorGrid {
    let url: URL, cell: Float, width: Float, height: Float
    private var loaded = false
    private(set) var columns = 0, rows = 0
    private var rgba: [UInt8] = []
    private var feature: [Float] = []   // clutter feature per cell (0 plain … 1 busy), -1 unknown

    init?(url: URL, cell: Float, width: Float, height: Float) {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        self.url = url; self.cell = cell; self.width = width; self.height = height
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return }
        columns = img.width; rows = img.height
        rgba = [UInt8](repeating: 0, count: columns*rows*4)
        let drawn = rgba.withUnsafeMutableBytes { buf -> Bool in
            guard let ctx = CGContext(data: buf.baseAddress, width: columns, height: rows, bitsPerComponent: 8, bytesPerRow: columns*4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: columns, height: rows))
            return true
        }
        if !drawn { columns = 0; rows = 0; rgba = []; return }
        computeFeatures()
    }

    /// The web's textureFeatures (src/surface-quality.mjs) over the grid: local contrast (fine and coarse) of lightness, averaged over a
    /// 7 × 7 neighbourhood, 0…1. At 2.5 cm cells, a 7-cell neighbourhood is about the size of a word.
    private func computeFeatures() {
        let n = columns*rows
        var luma = [Float](repeating: 0, count: n), known = [Bool](repeating: false, count: n)
        for i in 0..<n where rgba[i*4+3] > 127 {
            luma[i] = (Float(rgba[i*4])*0.2126 + Float(rgba[i*4+1])*0.7152 + Float(rgba[i*4+2])*0.0722)/255; known[i] = true
        }
        func at(_ x: Int, _ y: Int) -> Float { luma[min(rows-1, max(0, y))*columns + min(columns-1, max(0, x))] }
        var raw = [Float](repeating: 0, count: n)
        for y in 0..<rows { for x in 0..<columns where known[y*columns+x] {
            let v = at(x, y), fine = max(abs(v-at(x+1, y)), abs(v-at(x, y+1)))
            let coarse = abs(4*v - at(x-3, y) - at(x+3, y) - at(x, y-3) - at(x, y+3))/4
            raw[y*columns+x] = min(1, (fine+coarse)/0.09)
        } }
        feature = [Float](repeating: -1, count: n)
        for y in 0..<rows { for x in 0..<columns where known[y*columns+x] {
            var s: Float = 0, k: Float = 0
            for yy in max(0, y-3)...min(rows-1, y+3) { for xx in max(0, x-3)...min(columns-1, x+3) where known[yy*columns+xx] { s += raw[yy*columns+xx]; k += 1 } }
            feature[y*columns+x] = k > 0 ? s/k : -1
        } }
    }

    /// The cells over a rectangle of the surface (its own coordinates, metres): their colours (sRGB bytes) and clutter features,
    /// known cells only, at most about `limit` of them (evenly thinned).
    func region(x0: Float, x1: Float, y0: Float, y1: Float, limit: Int = 600) -> (pixels: [SIMD3<UInt8>], features: [Float], share: Float) {
        load()
        guard columns > 0 else { return ([], [], 0) }
        let c0 = max(0, Int(floor((x0 + width/2)/cell))), c1 = min(columns-1, Int(floor((x1 + width/2)/cell)))
        let r0 = max(0, Int(floor((height/2 - y1)/cell))), r1 = min(rows-1, Int(floor((height/2 - y0)/cell)))
        guard c0 <= c1, r0 <= r1 else { return ([], [], 0) }
        let total = (c1-c0+1)*(r1-r0+1), step = max(1, Int(sqrt(Double(total)/Double(limit))))
        var pixels: [SIMD3<UInt8>] = [], features: [Float] = [], seen = 0
        for r in stride(from: r0, through: r1, by: step) { for c in stride(from: c0, through: c1, by: step) {
            seen += 1
            let i = r*columns + c
            guard rgba[i*4+3] > 127 else { continue }
            pixels.append(SIMD3(rgba[i*4], rgba[i*4+1], rgba[i*4+2])); features.append(max(0, feature[i]))
        } }
        return (pixels, features, seen > 0 ? Float(pixels.count)/Float(seen) : 0)
    }
}
