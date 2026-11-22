import AppKit
import Foundation

// Native, offline SVG conversion. This does not create an application/window.
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: render-icon.swift SOURCE.svg DESTINATION.png\n", stderr)
    exit(64)
}
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
guard let image = NSImage(contentsOf: source), image.isValid else {
    fputs("macOS could not decode the application SVG.\n", stderr)
    exit(65)
}
guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
    let context = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(70) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
image.draw(in: NSRect(x: 0, y: 0, width: 1024, height: 1024), from: .zero,
    operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(70) }
try png.write(to: destination, options: .atomic)
