import { useChatStore } from "@/lib/chat-store"
import { useSettingsStore } from "@/lib/settings-store"

export type BetterC0deNotificationKind = "agent" | "permissions" | "errors"

export type NativeNotificationPermission =
  | NotificationPermission
  | "unsupported"

export interface RuntimeNotification {
  kind: BetterC0deNotificationKind
  title: string
  body: string
  tagSuffix: string
}

interface NativeNotificationInput {
  title: string
  body?: string
  tag: string
}

const RECENT_NOTIFICATION_MS = 1500
const recentNotificationTags = new Map<string, number>()

export function nativeNotificationPermission(): NativeNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported"
  }
  return window.Notification.permission
}

export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported"
  }
  if (window.Notification.permission === "granted") return "granted"
  if (window.Notification.permission === "denied") return "denied"
  return window.Notification.requestPermission()
}

export function shouldNotifyForThread(input: {
  threadId?: string | null
  activeThreadId?: string | null
  visibilityState?: DocumentVisibilityState
}): boolean {
  if (!input.threadId) return false
  if (input.visibilityState === "hidden") return true
  return Boolean(
    input.activeThreadId && input.activeThreadId !== input.threadId
  )
}

export function showNativeNotification(input: NativeNotificationInput): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false
  }
  if (window.Notification.permission !== "granted") return false

  const now = Date.now()
  const previous = recentNotificationTags.get(input.tag)
  if (previous && now - previous < RECENT_NOTIFICATION_MS) return false
  recentNotificationTags.set(input.tag, now)

  try {
    new window.Notification(input.title, {
      body: input.body,
      tag: input.tag,
    })
    return true
  } catch {
    return false
  }
}

export function runtimeNotificationFromEvent(
  type: string,
  payload: Record<string, unknown> = {}
): RuntimeNotification | null {
  const normalized = normalizeEventType(type)
  if (
    normalized === "toolapprovalrequested" ||
    normalized === "approvalrequested" ||
    normalized === "requestopened"
  ) {
    const toolName = stringFrom(payload.toolName) ?? stringFrom(payload.tool)
    const detail = stringFrom(payload.detail) ?? stringFrom(payload.command)
    return {
      kind: "permissions",
      title: "Approval requested",
      body: detail ?? (toolName ? `${toolName} needs approval.` : "The provider is waiting for approval."),
      tagSuffix: `approval:${stringFrom(payload.requestId) ?? toolName ?? "pending"}`,
    }
  }

  if (normalized === "userinputrequested") {
    return {
      kind: "permissions",
      title: "Input requested",
      body: "The provider is waiting for your answer.",
      tagSuffix: `input:${stringFrom(payload.requestId) ?? "pending"}`,
    }
  }

  if (
    normalized === "planapprovalrequested" ||
    normalized === "turnproposedcompleted"
  ) {
    return {
      kind: "permissions",
      title: "Plan ready for review",
      body: "A proposed plan is waiting for your review.",
      tagSuffix: `plan:${
        stringFrom(payload.requestId) ??
        stringFrom(payload.planId) ??
        stringFrom(payload.plan_id) ??
        stringFrom(payload.eventId) ??
        "latest"
      }`,
    }
  }

  if (
    normalized === "turnerror" ||
    normalized === "runtimeerror" ||
    normalized === "toolfailed"
  ) {
    const message =
      stringFrom(payload.error) ??
      stringFrom(payload.message) ??
      stringFrom(payload.detail) ??
      "A provider error occurred."
    return {
      kind: "errors",
      title: "Provider error",
      body: truncateNotificationBody(message),
      tagSuffix: `error:${stringFrom(payload.eventId) ?? stringFrom(payload.toolId) ?? normalized}`,
    }
  }

  return null
}

export function maybeNotifyRuntimeEvent(input: {
  threadId?: string | null
  type: string
  payload?: Record<string, unknown>
}): boolean {
  const notification = runtimeNotificationFromEvent(
    input.type,
    input.payload ?? {}
  )
  if (!notification) return false
  if (!notificationKindEnabled(notification.kind)) return false

  const chat = useChatStore.getState()
  if (
    !shouldNotifyForThread({
      threadId: input.threadId,
      activeThreadId: chat.activeThreadId,
      visibilityState:
        typeof document !== "undefined" ? document.visibilityState : "hidden",
    })
  ) {
    return false
  }

  return showNativeNotification({
    title: notification.title,
    body: notification.body,
    tag: `betterc0de:${input.threadId}:${notification.tagSuffix}`,
  })
}

export function maybeNotifyResponseComplete(input: {
  threadId?: string | null
}): boolean {
  if (!input.threadId) return false
  if (!notificationKindEnabled("agent")) return false

  const chat = useChatStore.getState()
  if (
    !shouldNotifyForThread({
      threadId: input.threadId,
      activeThreadId: chat.activeThreadId,
      visibilityState:
        typeof document !== "undefined" ? document.visibilityState : "hidden",
    })
  ) {
    return false
  }

  const thread = chat.threads.find((item) => item.id === input.threadId)
  return showNativeNotification({
    title: "Response ready",
    body: thread?.title || "BetterC0de finished the response.",
    tag: `betterc0de:${input.threadId}:response-ready`,
  })
}

function notificationKindEnabled(kind: BetterC0deNotificationKind): boolean {
  const settings = useSettingsStore.getState()
  if (kind === "agent") return settings.notificationAgent
  if (kind === "permissions") return settings.notificationPermissions
  return settings.notificationErrors
}

function normalizeEventType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function truncateNotificationBody(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value
}
