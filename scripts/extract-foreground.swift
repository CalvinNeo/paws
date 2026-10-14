import Foundation
import Vision
import CoreImage
import ImageIO

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: swift scripts/extract-foreground.swift INPUT_PHOTO OUTPUT_DIRECTORY\n", stderr)
    exit(1)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)

do {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "Pawpal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read the input photo."])
    }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let orientationValue = (properties?[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
    let orientation = CGImagePropertyOrientation(rawValue: orientationValue) ?? .up
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
        throw NSError(domain: "Pawpal", code: 2, userInfo: [NSLocalizedDescriptionKey: "No foreground subject was found."])
    }
    try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
    let context = CIContext()
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    for instance in observation.allInstances {
        let pixelBuffer = try observation.generateMaskedImage(ofInstances: IndexSet(integer: instance), from: handler, croppedToInstancesExtent: false)
        let maskedImage = CIImage(cvPixelBuffer: pixelBuffer)
        let destination = outputURL.appendingPathComponent("\(sourceURL.deletingPathExtension().lastPathComponent)-\(instance).png")
        try context.writePNGRepresentation(of: maskedImage, to: destination, format: .RGBA8, colorSpace: colorSpace)
        print(destination.path)
    }
} catch {
    fputs("Foreground extraction failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}
