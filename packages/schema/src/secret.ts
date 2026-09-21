import { z } from "zod"

export const secretStorageSchema = z.enum(["encrypted", "plaintext"])

/** Renderer-safe description of a stored secret. The value is never present. */
export const secretStateSchema = z.object({
  configured: z.boolean(),
  storage: secretStorageSchema,
})

/** Write-only mutation accepted for settings secrets. */
export const secretPatchSchema = z.union([
  z.object({ set: z.string().min(1) }).strict(),
  z.object({ clear: z.literal(true) }).strict(),
])

export type SecretStorage = z.infer<typeof secretStorageSchema>
export type SecretState = z.infer<typeof secretStateSchema>
export type SecretPatch = z.infer<typeof secretPatchSchema>
