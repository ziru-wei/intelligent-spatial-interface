import RealityKit
import UIKit
import CoreText
import simd

/// How answer text is set (Behavior): the body's size in the room, the heading's against the body, whether headings show, and the
/// hand-lettered font (Mansalva) for info answers, as the web editor (src/agent.mjs TEXT_BEHAVIOR).
struct TextSettings: Equatable {
    var bodySize: Float = 1, headingSize: Float = 1, showHeading = true, info = false
}

/// Answer text laid out once (CoreText) as glyph outlines, for drawing it whole or written so far, after the web editor
/// (src/agent.mjs glowTexture, src/text-writing.mjs): white with a soft glow on a transparent canvas COLUMNS px wide (the line length)
/// with PAD px margins; the material's tint gives its colour. The title larger than the body; markdown headings ("# …") in the body set
/// like it, or left out with the headings hidden.
final class TextLayout {
    static let columns: CGFloat = 1024, pad: CGFloat = 64
    struct Glyph { let path: CGPath; let em: CGFloat; let length: CGFloat }
    let size: CGSize
    let glyphs: [Glyph]
    let metrics: TextMetrics
    let key: String

    static let mansalvaRegistered: Bool = {
        guard let url = Bundle.main.url(forResource: "Mansalva-Regular", withExtension: "ttf") else { return false }
        _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)   // false when already registered: what counts is that it resolves
        return (CTFontCopyPostScriptName(CTFontCreateWithName("Mansalva-Regular" as CFString, 12, nil)) as String) == "Mansalva-Regular"
    }()

    init(title: String, body: String, settings s: TextSettings) {
        key = "\(title)\n\(body)\n\(s)"
        let useMansalva = s.info && Self.mansalvaRegistered
        func font(_ size: CGFloat, bold: Bool) -> CTFont {
            if useMansalva { return CTFontCreateWithName("Mansalva-Regular" as CFString, size, nil) }
            return CTFontCreateUIFontForLanguage(bold ? .emphasizedSystem : .system, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
        }
        let heading = 72*CGFloat(s.headingSize), bodyFont = font(46, bold: false)
        let para = NSMutableParagraphStyle(); para.lineBreakMode = .byWordWrapping; para.paragraphSpacing = 14
        let text = NSMutableAttributedString()
        func add(_ str: String, _ f: CTFont) { text.append(NSAttributedString(string: str, attributes: [.font: f, .paragraphStyle: para])) }
        if s.showHeading && !title.isEmpty { add(title + (body.isEmpty ? "" : "\n"), font(heading, bold: true)) }
        let paragraphs = body.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        for (i, para) in paragraphs.enumerated() {
            let end = i == paragraphs.count - 1 ? "" : "\n"
            if let m = para.firstMatch(of: /^\s*(#{1,6})\s+(.*)$/) {
                if s.showHeading { add(String(m.2) + end, font(m.1.count == 1 ? heading : heading*0.82, bold: true)) }
            } else { add(para + end, bodyFont) }
        }
        let inner = Self.columns - 2*Self.pad
        let framesetter = CTFramesetterCreateWithAttributedString(text)
        let fit = CTFramesetterSuggestFrameSizeWithConstraints(framesetter, CFRange(), nil, CGSize(width: inner, height: .greatestFiniteMagnitude), nil)
        let height = max(1, ceil(fit.height))
        size = CGSize(width: Self.columns, height: height + 2*Self.pad)
        // Glyph outlines in the canvas's own coordinates (y up, as CoreGraphics draws).
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(), CGPath(rect: CGRect(x: Self.pad, y: Self.pad, width: inner, height: height), transform: nil), nil)
        let lines = CTFrameGetLines(frame) as! [CTLine]
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(), &origins)
        var out: [Glyph] = []
        for (line, origin) in zip(lines, origins) {
            for run in CTLineGetGlyphRuns(line) as! [CTRun] {
                let n = CTRunGetGlyphCount(run)
                var gs = [CGGlyph](repeating: 0, count: n), ps = [CGPoint](repeating: .zero, count: n)
                CTRunGetGlyphs(run, CFRange(), &gs); CTRunGetPositions(run, CFRange(), &ps)
                let attrs = CTRunGetAttributes(run) as NSDictionary
                let f = attrs[kCTFontAttributeName] as! CTFont
                for i in 0..<n {
                    var t = CGAffineTransform(translationX: Self.pad + origin.x + ps[i].x, y: Self.pad + origin.y + ps[i].y)
                    guard let path = CTFontCreatePathForGlyph(f, gs[i], &t), !path.isEmpty else { continue }
                    out.append(Glyph(path: path, em: CTFontGetSize(f), length: Self.length(of: path)))
                }
            }
        }
        glyphs = out
        metrics = TextMetrics(aspect: Float(size.height/size.width), xHeightRatio: Float(CTFontGetXHeight(bodyFont)/Self.columns), scale: s.bodySize)
    }

    /// An outline's length (curves flattened).
    static func length(of path: CGPath) -> CGFloat {
        var total: CGFloat = 0, at = CGPoint.zero, start = CGPoint.zero
        func seg(_ p: CGPoint) { total += hypot(p.x - at.x, p.y - at.y); at = p }
        path.applyWithBlock { e in
            let p = e.pointee.points
            switch e.pointee.type {
            case .moveToPoint: at = p[0]; start = p[0]
            case .addLineToPoint: seg(p[0])
            case .addQuadCurveToPoint: let a = at; for k in 1...6 { let t = CGFloat(k)/6, u = 1 - t; seg(CGPoint(x: u*u*a.x + 2*u*t*p[0].x + t*t*p[1].x, y: u*u*a.y + 2*u*t*p[0].y + t*t*p[1].y)) }
            case .addCurveToPoint: let a = at; for k in 1...8 { let t = CGFloat(k)/8, u = 1 - t; seg(CGPoint(x: u*u*u*a.x + 3*u*u*t*p[0].x + 3*u*t*t*p[1].x + t*t*t*p[2].x, y: u*u*u*a.y + 3*u*u*t*p[0].y + 3*u*t*t*p[1].y + t*t*t*p[2].y)) }
            case .closeSubpath: seg(start)
            @unknown default: break
            }
        }
        return total
    }

    /// Where the pen is when `written` glyphs are drawn (canvas points, y up): along the current glyph's outline as far as it has traced
    /// it (render's trace), at its end while it fills in; nil when all are written.
    func penTip(written: Double) -> CGPoint? {
        let done = Int(written)
        guard done < glyphs.count else { return nil }
        let g = glyphs[done], p = CGFloat(written - Double(done)), want = g.length*min(1, p/0.85)
        var total: CGFloat = 0, at = CGPoint.zero, start = CGPoint.zero, found: CGPoint?
        func seg(_ q: CGPoint) {
            guard found == nil else { return }
            let d = hypot(q.x - at.x, q.y - at.y)
            if total + d >= want, d > 0 { let t = (want - total)/d; found = CGPoint(x: at.x + (q.x - at.x)*t, y: at.y + (q.y - at.y)*t) }
            total += d; at = q
        }
        g.path.applyWithBlock { e in
            let q = e.pointee.points
            switch e.pointee.type {
            case .moveToPoint: if found == nil && total == 0 && want == 0 { found = q[0] }; at = q[0]; start = q[0]
            case .addLineToPoint: seg(q[0])
            case .addQuadCurveToPoint: let a = at; for k in 1...6 { let t = CGFloat(k)/6, u = 1 - t; seg(CGPoint(x: u*u*a.x + 2*u*t*q[0].x + t*t*q[1].x, y: u*u*a.y + 2*u*t*q[0].y + t*t*q[1].y)) }
            case .addCurveToPoint: let a = at; for k in 1...8 { let t = CGFloat(k)/8, u = 1 - t; seg(CGPoint(x: u*u*u*a.x + 3*u*u*t*q[0].x + 3*u*t*t*q[1].x + t*t*t*q[2].x, y: u*u*u*a.y + 3*u*u*t*q[0].y + 3*u*t*t*q[1].y + t*t*t*q[2].y)) }
            case .closeSubpath: seg(start)
            @unknown default: break
            }
        }
        return found ?? at
    }

    /// The canvas with `written` glyphs (fractional: the current one partly drawn; nil: all). With `strokes` the current glyph is
    /// traced by a pen along its outline (inside its shape) and then fills in; without, each glyph just appears.
    func render(written: Double? = nil, strokes: Bool = true) -> CGImage? {
        let w = Int(size.width), h = Int(size.height)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.setStrokeColor(CGColor(gray: 1, alpha: 1))
        ctx.setShadow(offset: .zero, blur: 14, color: CGColor(gray: 1, alpha: 0.85))
        let n = written ?? Double(glyphs.count), done = min(glyphs.count, Int(n)), p = CGFloat(n - Double(done))
        for g in glyphs.prefix(done) { ctx.addPath(g.path) }
        ctx.fillPath()
        if done < glyphs.count, p > 0 {
            let g = glyphs[done]
            if strokes {
                let trace = min(1, p/0.85)
                ctx.saveGState(); ctx.addPath(g.path); ctx.clip()
                ctx.setLineWidth(g.em*0.15); ctx.setLineCap(.round); ctx.setLineJoin(.round)
                ctx.addPath(g.path.copy(dashingWithPhase: 0, lengths: [max(0.01, g.length*trace), g.length*2])); ctx.strokePath()
                ctx.restoreGState()
                if p > 0.85 { ctx.setAlpha((p - 0.85)/0.15); ctx.addPath(g.path); ctx.fillPath(); ctx.setAlpha(1) }
            } else { ctx.addPath(g.path); ctx.fillPath() }
        }
        return ctx.makeImage()
    }
}

/// An answer in the room: its text on a plane (the plane's +z is the surface's normal) and, when the style asks for one, a tinted
/// backing just behind it. Text can be written in glyph by glyph (Behavior: writing, its speed and pen strokes) as it streams.
@MainActor
final class AnswerEntity: Entity {
    private let textPlane = ModelEntity(), backing = ModelEntity()
    private(set) var placed: PlacedText?
    private(set) var layout: TextLayout?
    private var texture: TextureResource?, textureSize: CGSize = .zero
    /// The text's width and the bottom edge of its plane (this entity's frame), for hanging things under it.
    var textWidth: Float { placed?.width ?? 0 }
    private(set) var textBottom: Float?
    /// The answer's text as it came (to set it again in another look).
    var text = (title: "", body: "")
    /// The weather's text: the letters alone (no backing), drawn over everything real (only the hands, which visionOS shows over
    /// virtual content, cover it), after the weather itself.
    /// No backing (the weather's text, the FindMy text under the bar); drawn after the weather. Every answer's text, backing and pen are
    /// drawn over everything real (nothing but the hands covers them: visionOS shows the hands over the app).
    var overlay = false { didSet { if overlay != oldValue { texture = nil; textureSize = .zero } } }
    static let sortGroup = ModelSortGroup(depthPass: nil)
    private var group: ModelSortGroup { overlay ? WeatherEffect.sortGroup : Self.sortGroup }
    private var baseOrder: Int32 { overlay ? 10 : 0 }
    /// An info answer's box and marks (corners, arrow, lock), moved along with it.
    var infoBox: InfoTarget?
    var marks: InfoMarks?
    /// Whether its text has stopped streaming.
    var streamingDone: Bool { !streaming }
    // Writing: glyphs written so far, and the pace.
    struct Writing { var on = true; var strokes = true; var speed: Double = 30 }
    var writing = Writing()
    private var written = 0.0
    private var writer: Task<Void, Never>?
    private var streaming = false

    /// The pen writing it (stroke writing only): a 3D pen whose tip follows the trace, leaning back toward the viewer and to the right
    /// like a right hand holds it.
    private lazy var pen: Entity = { let p = Self.makePen(); p.isEnabled = false; addChild(p); return p }()
    static let penLean = V3(0.42, -0.32, 0.85).normalized

    required init() { super.init(); addChild(backing); addChild(textPlane) }

    private static func makePen() -> Entity {
        let pen = Entity()
        // Over everything real, like its text (so it never reads the room's depth).
        var body = PhysicallyBasedMaterial(); body.baseColor = .init(tint: UIColor(red: 0.12, green: 0.13, blue: 0.16, alpha: 1)); body.metallic = 0.6; body.roughness = 0.35
        var metal = PhysicallyBasedMaterial(); metal.baseColor = .init(tint: UIColor(white: 0.82, alpha: 1)); metal.metallic = 1.0; metal.roughness = 0.2
        body.readsDepth = false; metal.readsDepth = false
        var ink = UnlitMaterial(color: .white); ink.readsDepth = false
        ink.blending = .opaque
        // Built along +y from the tip at the origin, then turned to lean (penLean).
        let tip = ModelEntity(mesh: .generateCone(height: 0.016, radius: 0.0045), materials: [metal]); tip.position = V3(0, 0.008, 0); tip.orientation = simd_quatf(angle: .pi, axis: V3(1, 0, 0))
        let nib = ModelEntity(mesh: .generateSphere(radius: 0.0012), materials: [ink])
        let barrel = ModelEntity(mesh: .generateCylinder(height: 0.11, radius: 0.0045), materials: [body]); barrel.position = V3(0, 0.016 + 0.055, 0)
        let band = ModelEntity(mesh: .generateCylinder(height: 0.006, radius: 0.0047), materials: [metal]); band.position = V3(0, 0.02, 0)
        let cap = ModelEntity(mesh: .generateCylinder(height: 0.03, radius: 0.0048), materials: [metal]); cap.position = V3(0, 0.016 + 0.11 - 0.015, 0)
        let holder = Entity(); for e in [tip, nib, barrel, band, cap] { holder.addChild(e) }
        holder.orientation = simd_quatf(from: V3(0, 1, 0), to: penLean)
        pen.addChild(holder)
        return pen
    }

    /// The pen at the trace's tip (this entity's frame), moving there smoothly; hidden when not writing with strokes.
    private func movePen(_ layout: TextLayout, written: Double, active: Bool) {
        guard active, let p = placed, let tip = layout.penTip(written: written) else { pen.isEnabled = false; return }
        let width = p.width, height = width*layout.metrics.aspect, top = (p.height - height)/2
        let at = V3(Float(tip.x/layout.size.width - 0.5)*width, top + Float(tip.y/layout.size.height - 0.5)*height, 0.003)
        if !pen.isEnabled { pen.position = at; pen.isEnabled = true } else { pen.move(to: Transform(translation: at), relativeTo: self, duration: 0.045) }
    }

    /// Puts the text at a placement (space coordinates: this entity is a child of the space's root).
    func show(_ layout: TextLayout, at p: PlacedText, streaming: Bool) async {
        placed = p
        transform = Transform(matrix: p.transform)
        await setText(layout, streaming: streaming)
    }

    /// New text in the same place and width (the answer streaming in): the plane grows or shrinks downward from its top edge; with
    /// writing on, the new glyphs are written in at its pace.
    func setText(_ layout: TextLayout, streaming: Bool) async {
        guard placed != nil else { return }
        self.layout = layout; self.streaming = streaming
        if writing.on { startWriting() } else { written = Double(layout.glyphs.count); await draw(layout.render()) }
    }

    /// Moves to another place (the answer kept readable as the user moves), easing there; the text is set again at the new width.
    func move(to p: PlacedText) async {
        let from = transform, to = Transform(matrix: p.transform)
        placed = p
        texture = nil   // drawn again in the new place's look: its colour, its backing (wrapping the text at the new width)
        if let layout { await draw(writer == nil ? layout.render() : layout.render(written: written, strokes: writing.strokes)) }
        for k in 1...12 {
            let t = Float(k)/12, e = t*t*(3 - 2*t)
            transform = Transform(scale: .one, rotation: simd_slerp(from.rotation, to.rotation, e), translation: simd_mix(from.translation, to.translation, V3(repeating: e)))
            try? await Task.sleep(for: .milliseconds(25))
        }
    }

    private func startWriting() {
        guard writer == nil else { return }
        writer = Task { [weak self] in
            var last = Date()
            while !Task.isCancelled, let self, let layout = self.layout {
                let now = Date(), total = Double(layout.glyphs.count)
                self.written = min(total, self.written + now.timeIntervalSince(last)*self.writing.speed); last = now
                let finished = self.written >= total && !self.streaming
                await self.draw(finished ? layout.render() : layout.render(written: self.written, strokes: self.writing.strokes))
                self.movePen(layout, written: self.written, active: !finished && self.writing.strokes && self.written < total)
                if finished { self.writer = nil; self.pen.isEnabled = false; return }
                try? await Task.sleep(for: .milliseconds(45))
            }
        }
    }

    /// Lying on a table: turned a step toward reading away from the eye (eased: it follows the user smoothly). Each frame.
    func turnToward(eye: V3) {
        guard let p = placed, abs(p.normal.y) > 0.7, let b = TextPlacement.basis(normal: p.normal, at: position, eye: eye) else { return }
        let want = simd_quatf(simd_float3x3(columns: (b.right, b.up, p.normal)))
        orientation = simd_slerp(orientation, want, 0.08)
    }

    /// Writes the text in again from its first glyph (moved into a new look: the weather's).
    func restart() {
        written = 0
        if writing.on { startWriting() }
    }

    /// Whether text is still being written in (for the agent's status).
    var isWriting: Bool { writer != nil }

    private func draw(_ image: CGImage?) async {
        guard let image, let p = placed, let layout else { return }
        let width = p.width, height = width*layout.metrics.aspect
        if layout.size != textureSize || texture == nil {
            guard let tex = try? await TextureResource(image: image, options: .init(semantic: .color)) else { return }
            texture = tex; textureSize = layout.size
            var m = UnlitMaterial()
            m.color = .init(tint: UIColor(linear: p.style.text), texture: .init(tex))
            m.blending = .transparent(opacity: .init(floatLiteral: 1))
            m.readsDepth = false; m.writesDepth = false
            textPlane.components.set(ModelSortGroupComponent(group: group, order: baseOrder + 1))
            func sorted(_ e: Entity) { if e is ModelEntity { e.components.set(ModelSortGroupComponent(group: group, order: baseOrder + 2)) }; e.children.forEach(sorted) }
            sorted(pen)   // after its text: the pen over the letters
            textPlane.model = ModelComponent(mesh: .generatePlane(width: width, height: height), materials: [m])
            textPlane.position = V3(0, (p.height - height)/2, 0.001)
            textBottom = textPlane.position.y - height/2
            if let glass = p.style.glass, !overlay {
                var g = UnlitMaterial(color: UIColor(linear: glass.tint))
                g.blending = .transparent(opacity: .init(floatLiteral: 0.9*glass.mix)); g.readsDepth = false; g.writesDepth = false
                backing.components.set(ModelSortGroupComponent(group: group, order: baseOrder))
                // Wrapping the text with room to spare (its glyphs may reach into the canvas's padding).
                let margin = max(0.012, width*0.035)
                backing.model = ModelComponent(mesh: .generatePlane(width: width + 2*margin, height: height + 2*margin, cornerRadius: margin), materials: [g])
                backing.position = textPlane.position - V3(0, 0, 0.001)
                backing.isEnabled = true
            } else { backing.isEnabled = false }
        } else {
            try? texture?.replace(withImage: image, options: .init(semantic: .color))
            if textPlane.model?.mesh.bounds.extents.x != width { textPlane.model?.mesh = .generatePlane(width: width, height: height) }
        }
    }
}

extension UIColor {
    /// A colour from linear RGB (0…1), as the legibility maths gives it.
    convenience init(linear c: SIMD3<Float>) {
        let s = c.map { Legibility.toSrgb($0) }
        self.init(red: CGFloat(s.x), green: CGFloat(s.y), blue: CGFloat(s.z), alpha: 1)
    }
}

private extension SIMD3 where Scalar == Float {
    func map(_ f: (Float) -> Float) -> SIMD3<Float> { SIMD3(f(x), f(y), f(z)) }
}
