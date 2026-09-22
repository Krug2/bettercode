function shade(hue: number, saturation: number, lightness: number) {
  const light = lightness / 100, chroma = saturation / 100 * Math.min(light, 1 - light)
  const channel = (offset: number) => {
    const angle = (offset + hue / 30) % 12
    const value = light - chroma * Math.max(-1, Math.min(angle - 3, 9 - angle, 1))
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4)
  return { fill: `hsl(${hue} ${saturation}% ${lightness}%)`, ink: luminance > 0.179 ? "#000" : "#fff" }
}

export function blobPalette(hue: number, intensity: number | null) {
  const light = shade(hue, intensity === null ? 18 : 62, intensity === null ? 93 : 94 - intensity * 56)
  const dark = shade(hue, intensity === null ? 12 : 48, intensity === null ? 28 : 72 - intensity * 50)
  return {
    "--blob-fill": `light-dark(${light.fill}, ${dark.fill})`,
    "--blob-ink": `light-dark(${light.ink}, ${dark.ink})`,
    "--blob-stroke": `light-dark(hsl(${hue} 42% 48%), hsl(${hue} 40% 60%))`,
  }
}
