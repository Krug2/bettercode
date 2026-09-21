// Generate apps/shell/build/icon.ico (multi-size, PNG-in-ICO) and icon.png
// from apps/ui/public/favicon.svg. Run after the SVG changes:
//   node scripts/generate-icon.cjs
// electron-builder picks up apps/shell/build/icon.ico and icon.png
// as the macOS/Linux fallback automatically.
const fs = require("fs")
const path = require("path")
const sharp = require("sharp")

const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  const root = path.join(__dirname, "..")
  const svgPath = path.join(root, "apps", "ui", "public", "favicon.svg")
  const buildDir = path.join(root, "apps", "shell", "build")
  fs.mkdirSync(buildDir, { recursive: true })

  const innerSvg = fs.readFileSync(svgPath, "utf8")
  // Strip the outer <svg …> wrapper so we can re-wrap in a 100×100 viewBox
  // with a dark, rounded backplate. The light glyph would be invisible on
  // a light Windows taskbar / explorer background otherwise.
  const inner = innerSvg
    .replace(/<\?xml[^?]*\?>\s*/i, "")
    .replace(/<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")

  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#0a0a0a"/>
    ${inner}
  </svg>`

  const pngBuffers = await Promise.all(
    SIZES.map((size) =>
      sharp(Buffer.from(wrapped))
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  )

  const ico = encodeIco(SIZES, pngBuffers)
  fs.writeFileSync(path.join(buildDir, "icon.ico"), ico)

  await sharp(Buffer.from(wrapped))
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(buildDir, "icon.png"))

  console.log(
    `[icon] wrote apps/shell/build/icon.ico (${SIZES.join(",")}px, ${ico.length} bytes) and icon.png (512px)`,
  )
}

function encodeIco(sizes, pngBuffers) {
  const numImages = sizes.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = 1 (icon)
  header.writeUInt16LE(numImages, 4)

  const entries = []
  let dataOffset = 6 + 16 * numImages
  for (let i = 0; i < numImages; i++) {
    const size = sizes[i]
    const png = pngBuffers[i]
    const entry = Buffer.alloc(16)
    // Width / height: 0 means 256 in the ICO format.
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette colors (0 = no palette)
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(dataOffset, 12)
    entries.push(entry)
    dataOffset += png.length
  }
  return Buffer.concat([header, ...entries, ...pngBuffers])
}

main().catch((err) => {
  console.error("[icon] generation failed:", err)
  process.exit(1)
})
