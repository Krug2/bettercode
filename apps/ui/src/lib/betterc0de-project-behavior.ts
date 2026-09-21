import { useEffect, useState } from "react"
import {
  listProjectConfigSettings,
  type WorkspaceProjectConfigSetting,
} from "@/services/backend/workspaceApi"

export interface BetterC0deImageAttachmentPolicy {
  autoResize: boolean
  maxWidth: number
  maxHeight: number
  maxBase64Bytes: number
}

export const DEFAULT_BETTERC0DE_IMAGE_ATTACHMENT_POLICY: BetterC0deImageAttachmentPolicy =
  {
    autoResize: true,
    maxWidth: 2000,
    maxHeight: 2000,
    maxBase64Bytes: 5 * 1024 * 1024,
  }

export function imageAttachmentPolicyFromProjectConfig(
  settings: ReadonlyArray<Pick<WorkspaceProjectConfigSetting, "key" | "value">>,
  fallback: BetterC0deImageAttachmentPolicy = DEFAULT_BETTERC0DE_IMAGE_ATTACHMENT_POLICY
): BetterC0deImageAttachmentPolicy {
  const map = new Map(settings.map((setting) => [setting.key, setting.value]))
  return {
    autoResize: readConfigBoolean(
      map.get("attachment.image.auto_resize"),
      fallback.autoResize
    ),
    maxWidth: readConfigPositiveInt(
      map.get("attachment.image.max_width"),
      fallback.maxWidth
    ),
    maxHeight: readConfigPositiveInt(
      map.get("attachment.image.max_height"),
      fallback.maxHeight
    ),
    maxBase64Bytes: readConfigPositiveInt(
      map.get("attachment.image.max_base64_bytes"),
      fallback.maxBase64Bytes
    ),
  }
}

export function useBetterC0deProjectBehavior(
  projectPath: string | null | undefined,
  fallback: {
    imageAttachmentPolicy?: BetterC0deImageAttachmentPolicy
  } = {}
): {
  imageAttachmentPolicy: BetterC0deImageAttachmentPolicy
  loaded: boolean
} {
  const [state, setState] = useState<{
    projectPath: string | null
    settings: WorkspaceProjectConfigSetting[]
    loaded: boolean
  }>({ projectPath: null, settings: [], loaded: false })

  useEffect(() => {
    let cancelled = false
    const cwd = projectPath?.trim() || null
    if (!cwd) {
      setState({ projectPath: null, settings: [], loaded: true })
      return
    }
    setState((current) =>
      current.projectPath === cwd
        ? current
        : { projectPath: cwd, settings: [], loaded: false }
    )
    void listProjectConfigSettings(cwd)
      .then((settings) => {
        if (!cancelled) setState({ projectPath: cwd, settings, loaded: true })
      })
      .catch(() => {
        if (!cancelled) setState({ projectPath: cwd, settings: [], loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  return {
    loaded: state.loaded,
    imageAttachmentPolicy: imageAttachmentPolicyFromProjectConfig(
      state.settings,
      fallback.imageAttachmentPolicy
    ),
  }
}

function isTruthyConfigValue(value: string): boolean {
  return /^(1|true|yes|on)$/i.test(value.trim())
}

function readConfigBoolean(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined) return fallback
  if (isTruthyConfigValue(value)) return true
  if (/^(0|false|no|off)$/i.test(value.trim())) return false
  return fallback
}

function readConfigPositiveInt(
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
