// Cuts the orb out of public/apple-touch-icon.png: the light ground becomes transparent ("color to alpha"),
// so the soft edge of the orb stays soft. Usage: make-icon <in.png> <out.png> <size> [padding 0…0.4]
import AppKit

let a = CommandLine.arguments
guard a.count >= 4, let size = Int(a[3]), let src = NSImage(contentsOfFile: a[1]),
      let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("usage: make-icon <in.png> <out.png> <size> [padding]\n".data(using: .utf8)!); exit(1)
}

let W = cg.width, H = cg.height
var px = [UInt8](repeating: 0, count: W * H * 4)
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: &px, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))

// The ground is a soft gradient: fit a plane a + b·x + c·y per channel to a band along the edges.
func at(_ x: Int, _ y: Int, _ c: Int) -> Double { Double(px[(y * W + x) * 4 + c]) / 255 }
var plane = [[Double]](repeating: [0, 0, 0], count: 3)
do {
  var pts: [(Double, Double)] = []
  let band = max(4, W / 25)
  for y in stride(from: 0, to: H, by: 2) { for x in stride(from: 0, to: W, by: 2) where x < band || y < band || x >= W - band || y >= H - band { pts.append((Double(x), Double(y))) } }
  // Normal equations for 3 unknowns.
  for c in 0..<3 {
    var m = [[Double]](repeating: [0, 0, 0, 0], count: 3)
    for (x, y) in pts {
      let v = [1, x, y], z = at(Int(x), Int(y), c)
      for i in 0..<3 { for j in 0..<3 { m[i][j] += v[i] * v[j] }; m[i][3] += v[i] * z }
    }
    for i in 0..<3 { for k in i + 1..<3 { let f = m[k][i] / m[i][i]; for j in i..<4 { m[k][j] -= f * m[i][j] } } }
    var r = [0.0, 0.0, 0.0]
    for i in stride(from: 2, through: 0, by: -1) { var t = m[i][3]; for j in i + 1..<3 { t -= m[i][j] * r[j] }; r[i] = t / m[i][i] }
    plane[c] = r
  }
}
func ground(_ x: Int, _ y: Int, _ c: Int) -> Double { plane[c][0] + plane[c][1] * Double(x) + plane[c][2] * Double(y) }

// How far each pixel is from the ground, smoothed so the film grain does not count.
var dist = [Double](repeating: 0, count: W * H)
for y in 0..<H { for x in 0..<W { var d = 0.0; for c in 0..<3 { d = max(d, abs(at(x, y, c) - ground(x, y, c))) }; dist[y * W + x] = d } }
let R = max(2, W / 128)
func boxBlur(_ a: [Double]) -> [Double] {
  var tmp = a, out = a
  for y in 0..<H { var s = 0.0; for x in -R...R { s += a[y * W + min(W - 1, max(0, x))] }
    for x in 0..<W { tmp[y * W + x] = s / Double(2 * R + 1); s += a[y * W + min(W - 1, x + R + 1)] - a[y * W + max(0, x - R)] } }
  for x in 0..<W { var s = 0.0; for y in -R...R { s += tmp[min(H - 1, max(0, y)) * W + x] }
    for y in 0..<H { out[y * W + x] = s / Double(2 * R + 1); s += tmp[min(H - 1, y + R + 1) * W + x] - tmp[max(0, y - R) * W + x] } }
  return out
}
dist = boxBlur(dist)

// The orb is round: from its centre, everything inside the outermost clearly coloured pixel on each ray is solid,
// so pale highlights stay opaque. Outside that, the rim fades with the distance from the ground.
let SOLID = 0.22, BINS = 720
var cx = 0.0, cy = 0.0, n = 0.0
for y in 0..<H { for x in 0..<W where dist[y * W + x] > SOLID { cx += Double(x); cy += Double(y); n += 1 } }
cx /= n; cy /= n
func bin(_ x: Int, _ y: Int) -> Int { let a = atan2(Double(y) - cy, Double(x) - cx); return (Int((a + .pi) / (2 * .pi) * Double(BINS)) % BINS + BINS) % BINS }
var rmax = [Double](repeating: 0, count: BINS)
for y in 0..<H { for x in 0..<W where dist[y * W + x] > SOLID { let b = bin(x, y); rmax[b] = max(rmax[b], hypot(Double(x) - cx, Double(y) - cy)) } }
rmax = (0..<BINS).map { i in (-3...3).map { rmax[(i + $0 + BINS) % BINS] }.max()! }

func smooth(_ e0: Double, _ e1: Double, _ v: Double) -> Double { let t = min(1, max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
for y in 0..<H { for x in 0..<W {
  let i = (y * W + x) * 4
  let inside = hypot(Double(x) - cx, Double(y) - cy) <= rmax[bin(x, y)]
  let alpha = inside ? 1 : smooth(0.05, SOLID, dist[y * W + x])
  for c in 0..<3 {
    let p = at(x, y, c), g = ground(x, y, c)
    // Take the ground's colour back out of the half-transparent rim.
    let col = inside ? p : (alpha > 0.001 ? min(1, max(0, (p - g) / max(alpha, 0.12) + g)) : 0)
    px[i + c] = UInt8((col * alpha * 255).rounded())
  }
  px[i + 3] = UInt8((alpha * 255).rounded())
} }

let cut = ctx.makeImage()!
// Crop to the orb (about 70…440 of 512) with a little air, then scale.
let s = Double(W) / 512
let crop = cut.cropping(to: CGRect(x: 56 * s, y: 56 * s, width: 400 * s, height: 400 * s))!
let out = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
out.interpolationQuality = .high
let pad = a.count > 4 ? (Double(a[4]) ?? 0) * Double(size) : 0
out.draw(crop, in: CGRect(x: pad, y: pad, width: Double(size) - 2 * pad, height: Double(size) - 2 * pad))
let rep = NSBitmapImageRep(cgImage: out.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
