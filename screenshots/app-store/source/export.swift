import AppKit
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let destination = root.appendingPathComponent("screenshots/app-store")
let sourceDirectory = destination.appendingPathComponent("captured")
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

struct Shot {
    let name: String
    let source: String
    let blue: String
    let black: String
}

let shots = [
    Shot(name: "01-your-day", source: "IMG_4500.PNG", blue: "Your day.", black: "In one place."),
    Shot(name: "02-photo-meal-logging", source: "IMG_4503.PNG", blue: "Snap your meal.", black: "See the details."),
    Shot(name: "03-workout-tracking", source: "IMG_4506.PNG", blue: "Every set.", black: "Every rep."),
    Shot(name: "04-ai-coach", source: "IMG_4508.PNG", blue: "Plan your training", black: "with AI Coach."),
    Shot(name: "05-meal-history", source: "IMG_4502.PNG", blue: "Your meals.", black: "Made easy to track."),
    Shot(name: "06-workout-routines", source: "IMG_4501.PNG", blue: "Build a routine.", black: "Make it yours."),
    Shot(name: "07-review-nutrition", source: "IMG_4505.PNG", blue: "Review your macros.", black: "Before you log."),
    Shot(name: "08-bouldering-progress", source: "IMG_4507.PNG", blue: "Track your climbs.", black: "Every grade. Every send.")
]

struct DisplayTarget {
    let name: String
    let folder: String
    let width: Int
    let height: Int
    let frameSideMargin: CGFloat
    let framePadding: CGFloat
    let screenBottom: CGFloat
    let frameCornerRadius: CGFloat
    let screenCornerRadius: CGFloat
    let headlineSize: CGFloat
    let headline1Top: CGFloat
    let headline2Top: CGFloat
    let maxHeadlineWidth: CGFloat
}

let targets: [DisplayTarget] = [
    DisplayTarget(
        name: "iPhone 6.3-inch",
        folder: "iphone-6.3",
        width: 1206,
        height: 2622,
        frameSideMargin: 88,
        framePadding: 20,
        screenBottom: 60,
        frameCornerRadius: 96,
        screenCornerRadius: 80,
        headlineSize: 80,
        headline1Top: 66,
        headline2Top: 165,
        maxHeadlineWidth: 1060
    ),
    DisplayTarget(
        name: "iPhone 6.9-inch",
        folder: "iphone-6.9",
        width: 1320,
        height: 2868,
        frameSideMargin: 96,
        framePadding: 22,
        screenBottom: 65,
        frameCornerRadius: 105,
        screenCornerRadius: 88,
        headlineSize: 88,
        headline1Top: 72,
        headline2Top: 181,
        maxHeadlineWidth: 1160
    )
]

func load(_ url: URL) -> CGImage {
    let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
    return CGImageSourceCreateImageAtIndex(source, 0, nil)!
}

func canvas(_ w: Int, _ h: Int) -> CGContext {
    return CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
}

func save(_ image: CGImage, _ url: URL) {
    let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(output, image, nil)
    precondition(CGImageDestinationFinalize(output))
}

func label(_ text: String, top: CGFloat, size: CGFloat, color: NSColor, weight: NSFont.Weight, targetWidth: Int, targetHeight: Int, maxWidth: CGFloat) {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: style]
    let string = NSAttributedString(string: text, attributes: attributes)
    let measured = string.size()
    precondition(measured.width < maxWidth, "Headline exceeds safe width: \(text) (\(measured.width) >= \(maxWidth))")
    string.draw(at: NSPoint(x: (CGFloat(targetWidth) - measured.width) / 2, y: CGFloat(targetHeight) - top - measured.height))
}

for target in targets {
    let targetDir = destination.appendingPathComponent(target.folder)
    try FileManager.default.createDirectory(at: targetDir, withIntermediateDirectories: true)
    
    let screenWidth = CGFloat(target.width) - (target.frameSideMargin + target.framePadding) * 2
    var rendered: [CGImage] = []
    
    print("--- Rendering \(target.name) (\(target.width)x\(target.height)) into \(target.folder)/ ---")
    for shot in shots {
        let screenshot = load(sourceDirectory.appendingPathComponent(shot.source))
        let screenHeight = screenWidth * CGFloat(screenshot.height) / CGFloat(screenshot.width)
        let screenRect = CGRect(
            x: target.frameSideMargin + target.framePadding,
            y: target.screenBottom,
            width: screenWidth,
            height: screenHeight
        )
        let frameRect = screenRect.insetBy(dx: -target.framePadding, dy: -target.framePadding)
        let context = canvas(target.width, target.height)
        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: target.width, height: target.height))
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
                cornerWidth: target.frameCornerRadius,
                cornerHeight: target.frameCornerRadius,
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
                cornerWidth: target.screenCornerRadius,
                cornerHeight: target.screenCornerRadius,
                transform: nil
            )
        )
        context.clip()
        context.draw(screenshot, in: screenRect)
        context.restoreGState()

        context.saveGState()
        context.addPath(
            CGPath(
                roundedRect: screenRect,
                cornerWidth: target.screenCornerRadius,
                cornerHeight: target.screenCornerRadius,
                transform: nil
            )
        )
        context.setStrokeColor(NSColor(srgbRed: 0.14, green: 0.17, blue: 0.19, alpha: 1).cgColor)
        context.setLineWidth(2)
        context.strokePath()
        context.restoreGState()

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        label(shot.blue, top: target.headline1Top, size: target.headlineSize, color: NSColor(srgbRed: 0.125, green: 0.541, blue: 0.937, alpha: 1), weight: .semibold, targetWidth: target.width, targetHeight: target.height, maxWidth: target.maxHeadlineWidth)
        label(shot.black, top: target.headline2Top, size: target.headlineSize, color: NSColor(srgbRed: 0.065, green: 0.075, blue: 0.09, alpha: 1), weight: .semibold, targetWidth: target.width, targetHeight: target.height, maxWidth: target.maxHeadlineWidth)
        NSGraphicsContext.restoreGraphicsState()
        
        let image = context.makeImage()!
        let url = targetDir.appendingPathComponent("\(shot.name).png")
        save(image, url)
        rendered.append(image)
        print("Exported \(target.folder)/\(shot.name).png: \(image.width)x\(image.height), opaque sRGB")
    }
    
    // Generate preview strip for 6.3" display
    if target.folder == "iphone-6.3" {
        let thumbWidth = 241, thumbHeight = 524, gap = 16
        let overview = canvas(thumbWidth * shots.count + gap * (shots.count + 1), thumbHeight + gap * 2)
        overview.setFillColor(NSColor(srgbRed: 0.91, green: 0.93, blue: 0.95, alpha: 1).cgColor)
        overview.fill(CGRect(x: 0, y: 0, width: overview.width, height: overview.height))
        overview.interpolationQuality = .high
        for (index, image) in rendered.enumerated() {
            overview.draw(image, in: CGRect(x: gap + index * (thumbWidth + gap), y: gap, width: thumbWidth, height: thumbHeight))
        }
        save(overview.makeImage()!, destination.appendingPathComponent("preview-6.3.png"))
        save(overview.makeImage()!, destination.appendingPathComponent("preview.png"))
    }
}
