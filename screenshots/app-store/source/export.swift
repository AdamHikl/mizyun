import AppKit
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let destination = root.appendingPathComponent("screenshots/app-store")
let width = 1320, height = 2868
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
struct Shot {
    let name: String
    let source: String
    let blue: String
    let black: String
}
let shots = [
    Shot(name: "01-your-day", source: "IMG_3707.PNG", blue: "Your day.", black: "In one place."),
    Shot(name: "02-photo-meal-logging", source: "IMG_3715.PNG", blue: "Snap your meal.", black: "See the details."),
    Shot(name: "03-workout-tracking", source: "IMG_3713.PNG", blue: "Every set.", black: "Every rep."),
    Shot(name: "04-ai-coach", source: "IMG_3710.PNG", blue: "Plan your training", black: "with AI Coach."),
    Shot(name: "05-meal-history", source: "IMG_3709.PNG", blue: "Your meals.", black: "Made easy to track."),
    Shot(name: "06-workout-routines", source: "IMG_3711.PNG", blue: "Build a routine.", black: "Make it yours."),
    Shot(name: "07-review-nutrition", source: "IMG_3714.PNG", blue: "Review your macros.", black: "Before you log.")
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
func label(_ text: String, top: CGFloat, size: CGFloat, color: NSColor, weight: NSFont.Weight) {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: style]
    let string = NSAttributedString(string: text, attributes: attributes)
    let measured = string.size()
    precondition(measured.width < 1160, "Headline exceeds safe width: \(text)")
    string.draw(at: NSPoint(x: (CGFloat(width) - measured.width) / 2, y: CGFloat(height) - top - measured.height))
}
let template = load(destination.appendingPathComponent("source/phone-template.png"))
var rendered: [CGImage] = []
for shot in shots {
    let context = canvas(width, height)
    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high
    // Reuse the generated frame; original app pixels are inserted independently.
    context.draw(template, in: CGRect(x: 0, y: CGFloat(height) - 2870, width: CGFloat(width), height: 3030))
    let screenshot = load(root.appendingPathComponent("screenshots/\(shot.source)"))
    let screenWidth: CGFloat = 890
    let screenHeight = screenWidth * CGFloat(screenshot.height) / CGFloat(screenshot.width)
    let rect = CGRect(x: 215, y: CGFloat(height) - 671 - screenHeight, width: screenWidth, height: screenHeight)
    context.saveGState()
    context.addPath(CGPath(roundedRect: rect, cornerWidth: 100, cornerHeight: 100, transform: nil))
    context.clip()
    context.draw(screenshot, in: rect)
    context.restoreGState()
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    label("mizyun", top: 105, size: 38, color: NSColor(srgbRed: 0.39, green: 0.44, blue: 0.49, alpha: 1), weight: .semibold)
    label(shot.blue, top: 230, size: 88, color: NSColor(srgbRed: 0.125, green: 0.541, blue: 0.937, alpha: 1), weight: .semibold)
    label(shot.black, top: 339, size: 88, color: NSColor(srgbRed: 0.065, green: 0.075, blue: 0.09, alpha: 1), weight: .semibold)
    NSGraphicsContext.restoreGraphicsState()
    let image = context.makeImage()!
    let url = destination.appendingPathComponent("iphone-6.9/\(shot.name).png")
    save(image, url)
    rendered.append(image)
    print("Exported \(url.lastPathComponent): \(image.width)x\(image.height), opaque sRGB")
}
let thumbWidth = 264, thumbHeight = 574, gap = 18
let overview = canvas(thumbWidth * 7 + gap * 8, thumbHeight + gap * 2)
overview.setFillColor(NSColor(srgbRed: 0.91, green: 0.93, blue: 0.95, alpha: 1).cgColor)
overview.fill(CGRect(x: 0, y: 0, width: overview.width, height: overview.height))
overview.interpolationQuality = .high
for (index, image) in rendered.enumerated() {
    overview.draw(image, in: CGRect(x: gap + index * (thumbWidth + gap), y: gap, width: thumbWidth, height: thumbHeight))
}
save(overview.makeImage()!, destination.appendingPathComponent("preview.png"))
