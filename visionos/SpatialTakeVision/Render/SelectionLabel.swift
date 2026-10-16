import RealityKit
import UIKit

/// Room view's label over a thing carrying info: its key and share of the selection (src/selection-marks.mjs), a dark pill with the score's
/// colour: tone 2 the selection, 1 a contender (as likely as nothing meant or more), 0 below.
enum SelectionLabel {
    @MainActor
    static func make(_ text: String, tone: Int) -> ModelEntity {
        let color: UIColor = tone == 2 ? UIColor(red: 0.5, green: 0.88, blue: 0.78, alpha: 1) : tone == 1 ? UIColor(red: 0.29, green: 0.66, blue: 0.57, alpha: 1) : UIColor(white: 0.6, alpha: 1)
        let font = UIFont.systemFont(ofSize: 28, weight: .semibold), size = CGSize(width: 360, height: 56)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = false
        let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor(white: 0.06, alpha: 0.86).setFill(); UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 12).fill()
            let s = NSAttributedString(string: text.count > 22 ? String(text.prefix(21)) + "…" : text, attributes: [.font: font, .foregroundColor: color])
            s.draw(at: CGPoint(x: 14, y: (size.height - s.size().height)/2))
        }.cgImage!
        var m = UnlitMaterial()
        if let tex = try? TextureResource(image: image, options: .init(semantic: .color)) { m.color = .init(tint: .white, texture: .init(tex)) }
        m.blending = .transparent(opacity: .init(floatLiteral: 1)); m.readsDepth = false
        return ModelEntity(mesh: .generatePlane(width: 0.36, height: 0.056), materials: [m])
    }
}
