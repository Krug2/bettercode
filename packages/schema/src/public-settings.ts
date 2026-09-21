import { z } from "zod"
import { isSensitiveProviderFieldName } from "./provider-instance"
import { secretStateSchema } from "./secret"
import { defaultSettings, settingsSchema } from "./settings"

const requiredKeys = Object.keys(defaultSettings())

/** Validate the redacted view without turning metadata back into credentials. */
export const publicSettingsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((view, context) => {
    for (const key of requiredKeys) {
      if (!Object.hasOwn(view, key))
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Missing settings field",
        })
    }
    const validateSecrets = (
      value: unknown,
      path: (string | number)[] = []
    ): unknown => {
      if (Array.isArray(value))
        return value.map((item, index) =>
          validateSecrets(item, [...path, index])
        )
      if (!value || typeof value !== "object") return value
      const result: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(value)) {
        const fieldPath = [...path, key]
        if (key === "secretState" || key === "secret_state") {
          if (!secretStateSchema.safeParse(nested).success)
            context.addIssue({
              code: "custom",
              path: fieldPath,
              message: "Invalid secret metadata",
            })
          result[key] = nested
        } else if (
          isSensitiveProviderFieldName(key) ||
          (path[0] === "mcp_servers" && key === "envVars")
        ) {
          if (!secretStateSchema.safeParse(nested).success)
            context.addIssue({
              code: "custom",
              path: fieldPath,
              message: "Expected redacted secret metadata",
            })
          // Only the validation copy needs the private schema's string shape.
          result[key] = ""
        } else {
          result[key] = validateSecrets(nested, fieldPath)
        }
      }
      if (
        path[0] === "provider_instances" &&
        path.includes("environment") &&
        result.sensitive === true &&
        result.value !== ""
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, "value"],
          message: "Sensitive environment value must be redacted",
        })
      }
      return result
    }
    const result = settingsSchema.safeParse(validateSecrets(view))
    if (!result.success) {
      for (const issue of result.error.issues)
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: "Invalid public settings field",
        })
    }
  })
export type PublicSettings = z.infer<typeof publicSettingsSchema>
