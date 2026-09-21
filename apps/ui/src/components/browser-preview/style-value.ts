export interface NumericStyleValue {
  number: number
  unit: string
}

export function parseStyleNumber(value: string): NumericStyleValue | null {
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i)
  if (!match || !Number.isFinite(Number(match[1]))) return null
  return { number: Number(match[1]), unit: match[2] }
}

export function styleStep(shiftKey: boolean, altKey: boolean): number {
  return shiftKey ? 10 : altKey ? 0.1 : 1
}

export function adjustStyleNumber(
  value: string,
  delta: number,
  min = -Infinity,
  max = Infinity
): string | null {
  const parsed = parseStyleNumber(value)
  if (!parsed || !Number.isFinite(delta)) return null
  const next = Math.min(max, Math.max(min, parsed.number + delta))
  return `${Math.round(next * 1000) / 1000}${parsed.unit}`
}

export function displayStyleValue(value: string, unit?: string): string {
  const parsed = parseStyleNumber(value)
  return unit && parsed?.unit === unit ? String(parsed.number) : value
}

export function cssStyleValue(value: string, unit?: string): string {
  const trimmed = value.trim()
  const parsed = parseStyleNumber(trimmed)
  return unit && parsed && !parsed.unit ? `${trimmed}${unit}` : trimmed
}
