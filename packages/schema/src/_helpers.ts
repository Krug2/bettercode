import { z } from "zod"

export function pick<T>(obj: Record<string, unknown>, a: string, b: string): T | undefined {
  return (obj[a] ?? obj[b]) as T | undefined
}

export const zStr = z.coerce.string()
export const zNullishStr = z.string().nullish()
