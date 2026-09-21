export type BetterC0deShareMode = "manual" | "auto" | "disabled"

export interface BetterC0deShareSetting {
  key: string
  value: string
}

export function betterC0deShareModeFromProjectSettings(
  settings: ReadonlyArray<BetterC0deShareSetting>
): BetterC0deShareMode | null {
  let mode: BetterC0deShareMode | null = null
  let runtimeAutoShare = false
  for (const setting of settings) {
    const value = setting.value.trim().toLowerCase()
    if (
      setting.key === "share" &&
      (value === "manual" || value === "auto" || value === "disabled")
    ) {
      mode = value
    }
    if (setting.key === "autoshare" && value === "true" && !mode) {
      mode = "auto"
    }
    if (setting.key === "runtime.autoShare" && value === "enabled") {
      runtimeAutoShare = true
    }
  }
  if (mode === "disabled") return "disabled"
  if (runtimeAutoShare) return "auto"
  return mode
}
