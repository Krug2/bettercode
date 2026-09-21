/**
 * Environment-variable tuning knobs read by several startup phases. Pure:
 * an unset, non-numeric or non-positive value means "use the default".
 */
export function positiveEnvMs(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function positiveEnvInteger(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
