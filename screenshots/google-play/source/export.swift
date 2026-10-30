import AppKit
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceDirectory = root.appendingPathComponent("screenshots/google-play/captured")
let destination = root.appendingPathComponent("screenshots/google-play")
let outputDirectory = destination.appendingPathComponent("phone-9x16")
let width = 1440
let height = 2560
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

struct Shot {
    let name: String
    let source: String
    let blue: String
    let black: String
}

let shots = [
    Shot(
        name: "01-your-day",
        source: "IMG_4500.PNG",
        blue: "Your day.",
        black: "In one place."
    ),
    Shot(
        name: "02-photo-meal-logging",
        source: "IMG_4503.PNG",
        blue: "Snap your meal.",
        black: "See the details."
    ),
    Shot(
        name: "03-workout-tracking",
        source: "IMG_4506.PNG",
        blue: "Every set.",
        black: "Every rep."
    ),
    Shot(
        name: "04-ai-coach",
        source: "IMG_4508.PNG",
        blue: "Plan your training",
        black: "with AI Coach."
    ),
    Shot(
        name: "05-meal-history",
        source: "IMG_4502.PNG",
        blue: "Your meals.",
        black: "Made easy to track."
    ),
    Shot(
        name: "06-workout-routines",
        source: "IMG_4501.PNG",
        blue: "Build a routine.",
        black: "Make it yours."
    ),
    Shot(
        name: "07-review-nutrition",
        source: "IMG_4505.PNG",
        blue: "Review your macros.",
        black: "Before you log."
    ),
    Shot(
        name: "08-bouldering-progress",
        source: "IMG_4507.PNG",
        blue: "Track your climbs.",
        black: "Every grade. Every send."
    ),
]

func load(_ url: URL) -> CGImage {
    guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        fatalError("Could not load image: \(url.path)")
    }
    return image
}

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

func label(
    _ text: String,
    top: CGFloat,
    size: CGFloat,
    color: NSColor,
    weight: NSFont.Weight
) {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: style,
    ]
    let string = NSAttributedString(string: text, attributes: attributes)
    let measured = string.size()
    precondition(measured.width < 1260, "Headline exceeds safe width: \(text)")
    string.draw(
        at: NSPoint(
            x: (CGFloat(width) - measured.width) / 2,
            y: CGFloat(height) - top - measured.height
        )
    )
}

try FileManager.default.createDirectory(
    at: outputDirectory,
    withIntermediateDirectories: true
)

let framePadding: CGFloat = 22
let frameTop: CGFloat = 320
let frameBottom: CGFloat = 30
let frameCornerRadius: CGFloat = 66
let screenCornerRadius: CGFloat = 46

var rendered: [CGImage] = []

for shot in shots {
    let screenshot = load(sourceDirectory.appendingPathComponent(shot.source))
    let screenHeight = CGFloat(height) - frameTop - frameBottom - framePadding * 2
    let screenWidth = screenHeight * CGFloat(screenshot.width) / CGFloat(screenshot.height)
    let frameRect = CGRect(
        x: (CGFloat(width) - screenWidth) / 2 - framePadding,
        y: frameBottom,
        width: screenWidth + framePadding * 2,
        height: CGFloat(height) - frameTop - frameBottom
    )
    let screenRect = frameRect.insetBy(dx: framePadding, dy: framePadding)

    let context = canvas(width, height)
    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high

    context.saveGState()
    context.setShadow(
        offset: CGSize(width: 0, height: -12),
        blur: 34,
        color: NSColor(srgbRed: 0.38, green: 0.48, blue: 0.58, alpha: 0.24).cgColor
    )
    context.addPath(
        CGPath(
            roundedRect: frameRect,
            cornerWidth: frameCornerRadius,
            cornerHeight: frameCornerRadius,
            transform: nil
        )
    )
    context.setFillColor(NSColor(srgbRed: 0.035, green: 0.043, blue: 0.050, alpha: 1).cgColor)
    context.fillPath()
    context.restoreGState()

    context.saveGState()
    context.addPath(
        CGPath(
            roundedRect: screenRect,
            cornerWidth: screenCornerRadius,
            cornerHeight: screenCornerRadius,
            transform: nil
        )
    )
    context.clip()
    // Preserve the complete physical-device capture and its original aspect
    // ratio. Only the rounded outer corners are masked by the screen shape.
    context.draw(screenshot, in: screenRect)
    context.restoreGState()

    context.saveGState()
    context.addPath(
        CGPath(
            roundedRect: screenRect,
            cornerWidth: screenCornerRadius,
            cornerHeight: screenCornerRadius,
            transform: nil
        )
    )
    context.setStrokeColor(NSColor(srgbRed: 0.14, green: 0.17, blue: 0.19, alpha: 1).cgColor)
    context.setLineWidth(2)
    context.strokePath()
    context.restoreGState()

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    label(
        shot.blue,
        top: 62,
        size: 90,
        color: NSColor(srgbRed: 0.125, green: 0.541, blue: 0.937, alpha: 1),
        weight: .semibold
    )
    label(
        shot.black,
        top: 170,
        size: 90,
        color: NSColor(srgbRed: 0.065, green: 0.075, blue: 0.09, alpha: 1),
        weight: .semibold
    )
    NSGraphicsContext.restoreGraphicsState()

    let image = context.makeImage()!
    let url = outputDirectory.appendingPathComponent("\(shot.name).png")
    save(image, url)
    rendered.append(image)
    print("Exported \(url.lastPathComponent): \(image.width)x\(image.height), opaque sRGB")
}

let thumbnailWidth = 180
let thumbnailHeight = 320
let gap = 16
let overview = canvas(thumbnailWidth * rendered.count + gap * (rendered.count + 1), thumbnailHeight + gap * 2)
overview.setFillColor(NSColor(srgbRed: 0.91, green: 0.93, blue: 0.95, alpha: 1).cgColor)
overview.fill(CGRect(x: 0, y: 0, width: overview.width, height: overview.height))
overview.interpolationQuality = .high

for (index, image) in rendered.enumerated() {
    overview.draw(
        image,
        in: CGRect(
            x: gap + index * (thumbnailWidth + gap),
            y: gap,
            width: thumbnailWidth,
            height: thumbnailHeight
        )
    )
}

save(overview.makeImage()!, destination.appendingPathComponent("preview.png"))
