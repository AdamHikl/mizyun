import AppKit
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let destination = root.appendingPathComponent("screenshots/google-play/feature-graphic.png")
let width = 1024
let height = 500
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

func canvas(_ canvasWidth: Int, _ canvasHeight: Int) -> CGContext {
    guard
        let context = CGContext(
            data: nil,
            width: canvasWidth,
            height: canvasHeight,
            bitsPerComponent: 8,
            bytesPerRow: canvasWidth * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        )
    else {
        fatalError("Could not create canvas")
    }
    return context
}

func save(_ image: CGImage, _ url: URL) {
    guard
        let output = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
        )
    else {
        fatalError("Could not create image destination: \(url.path)")
    }
    CGImageDestinationAddImage(output, image, nil)
    precondition(CGImageDestinationFinalize(output), "Could not save image: \(url.path)")
}

func centeredLabel(
    _ text: String,
    top: CGFloat,
    size: CGFloat,
    color: NSColor,
    weight: NSFont.Weight,
    tracking: CGFloat = 0
) {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: style,
        .kern: tracking,
    ]
    let string = NSAttributedString(string: text, attributes: attributes)
    let measured = string.size()
    precondition(measured.width < 820, "Feature graphic text exceeds safe width: \(text)")
    string.draw(
        at: NSPoint(
            x: (CGFloat(width) - measured.width) / 2,
            y: CGFloat(height) - top - measured.height
        )
    )
}

let context = canvas(width, height)

let gradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        NSColor(srgbRed: 0.025, green: 0.25, blue: 0.78, alpha: 1).cgColor,
        NSColor(srgbRed: 0.035, green: 0.48, blue: 0.96, alpha: 1).cgColor,
        NSColor(srgbRed: 0.10, green: 0.68, blue: 0.96, alpha: 1).cgColor,
    ] as CFArray,
    locations: [0, 0.56, 1]
)!
context.drawLinearGradient(
    gradient,
    start: CGPoint(x: 0, y: 0),
    end: CGPoint(x: CGFloat(width), y: CGFloat(height)),
    options: []
)

// Edge-only atmosphere keeps the central focal area clean for Play surfaces
// that crop or overlay portions of the feature graphic.
context.setFillColor(NSColor(srgbRed: 0.30, green: 0.78, blue: 1, alpha: 0.18).cgColor)
context.fillEllipse(in: CGRect(x: -170, y: 210, width: 390, height: 390))
context.setFillColor(NSColor(srgbRed: 0.15, green: 0.20, blue: 0.72, alpha: 0.22).cgColor)
context.fillEllipse(in: CGRect(x: 850, y: -165, width: 350, height: 350))
context.setStrokeColor(NSColor.white.withAlphaComponent(0.11).cgColor)
context.setLineWidth(2)
context.strokeEllipse(in: CGRect(x: -78, y: 92, width: 220, height: 220))
context.strokeEllipse(in: CGRect(x: 910, y: 305, width: 170, height: 170))

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
centeredLabel(
    "Mizyun",
    top: 88,
    size: 78,
    color: .white,
    weight: .bold,
    tracking: -1.4
)
centeredLabel(
    "Nutrition. Training. Progress.",
    top: 208,
    size: 38,
    color: .white,
    weight: .semibold,
    tracking: -0.35
)
centeredLabel(
    "Built around your goals.",
    top: 280,
    size: 25,
    color: NSColor.white.withAlphaComponent(0.86),
    weight: .medium
)
NSGraphicsContext.restoreGraphicsState()

let accentWidth: CGFloat = 92
let accentHeight: CGFloat = 9
let accentGap: CGFloat = 15
let accentsWidth = accentWidth * 3 + accentGap * 2
let accentStartX = (CGFloat(width) - accentsWidth) / 2
let accentY: CGFloat = 82
let accentColors = [
    NSColor(srgbRed: 0.08, green: 0.86, blue: 0.65, alpha: 1),
    NSColor(srgbRed: 1.00, green: 0.69, blue: 0.12, alpha: 1),
    NSColor(srgbRed: 0.67, green: 0.40, blue: 1.00, alpha: 1),
]

for (index, color) in accentColors.enumerated() {
    let rect = CGRect(
        x: accentStartX + CGFloat(index) * (accentWidth + accentGap),
        y: accentY,
        width: accentWidth,
        height: accentHeight
    )
    context.addPath(
        CGPath(
            roundedRect: rect,
            cornerWidth: accentHeight / 2,
            cornerHeight: accentHeight / 2,
            transform: nil
        )
    )
    context.setFillColor(color.cgColor)
    context.fillPath()
}

let image = context.makeImage()!
save(image, destination)
print("Exported \(destination.lastPathComponent): \(image.width)x\(image.height), opaque sRGB")
