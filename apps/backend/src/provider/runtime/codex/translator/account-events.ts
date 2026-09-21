import type { ProviderRuntimeEvent } from "../../contracts"
import { randomUUID } from "node:crypto"
import {
  codexErrorNotificationSchema,
} from "../protocol"
import type { CodexNotificationContext } from "./context"
import {
  readOptionalString,
  base,
  readTurnId,
  readRequestId,
} from "./shared"

/**
 * Errors, model routing, configuration notices, account, MCP, remote
 * control, app list, imports, file system and fuzzy search notifications.
 *
 * Returns the translated events, or null when the notification is not one
 * of this family's.
 */
export function translateAccountEvents(
  ctx: CodexNotificationContext
): ProviderRuntimeEvent[] | null {
  const { threadId, method, params } = ctx
  const out: ProviderRuntimeEvent[] = []

  if (method === "error") {
    const parsed = codexErrorNotificationSchema.safeParse(params)
    if (parsed.success) {
      const d = parsed.data
      const msg = d.error.message
      if (d.willRetry === true) {
        out.push({
          ...base(threadId),
          type: "runtime.warning",
          message: msg,
          willRetry: true,
          detail: d,
        })
      } else {
        out.push({
          ...base(threadId),
          type: "runtime.error",
          message: msg,
          class: "provider_error",
          detail: d,
        })
      }
    }
    return out
  }
  if (method === "model/rerouted") {
    const fromModel = readOptionalString(params, ["fromModel", "from_model"])
    const toModel = readOptionalString(params, ["toModel", "to_model"])
    const reason =
      readOptionalString(params, ["reason"]) ?? "Provider rerouted the model"
    if (fromModel && toModel) {
      out.push({
        ...base(threadId),
        type: "model.rerouted",
        turnId: readTurnId(params),
        payload: { fromModel, toModel, reason },
      })
    }
    return out
  }
  if (method === "configWarning") {
    const summary = readOptionalString(params, ["summary", "message"])
    if (summary) {
      out.push({
        ...base(threadId),
        type: "config.warning",
        turnId: readTurnId(params),
        payload: {
          summary,
          ...(readOptionalString(params, ["details", "detail"])
            ? { details: readOptionalString(params, ["details", "detail"]) }
            : {}),
          ...(readOptionalString(params, ["path"])
            ? { path: readOptionalString(params, ["path"]) }
            : {}),
          ...((params as Record<string, unknown>).range !== undefined
            ? { range: (params as Record<string, unknown>).range }
            : {}),
        },
      })
    }
    return out
  }
  if (method === "deprecationNotice") {
    const summary = readOptionalString(params, ["summary", "message"])
    if (summary) {
      out.push({
        ...base(threadId),
        type: "deprecation.notice",
        turnId: readTurnId(params),
        payload: {
          summary,
          ...(readOptionalString(params, ["details", "detail"])
            ? { details: readOptionalString(params, ["details", "detail"]) }
            : {}),
        },
      })
    }
    return out
  }
  if (method === "account/updated") {
    out.push({
      ...base(threadId),
      type: "account.updated",
      turnId: readTurnId(params),
      payload: {
        account: (params as Record<string, unknown>).account ?? params,
      },
    })
    return out
  }
  if (method === "account/rateLimits/updated") {
    out.push({
      ...base(threadId),
      type: "account.rate-limits.updated",
      turnId: readTurnId(params),
      payload: {
        rateLimits:
          (params as Record<string, unknown>).rateLimits ??
          (params as Record<string, unknown>).rate_limits ??
          params,
      },
    })
    return out
  }
  if (method === "account/login/completed") {
    const record =
      params && typeof params === "object"
        ? (params as Record<string, unknown>)
        : {}
    const success = record.success === true
    out.push({
      ...base(threadId),
      type: "auth.status",
      turnId: readTurnId(params),
      payload: {
        isAuthenticating: false,
        ...(success
          ? { output: ["Account login completed"] }
          : {
              error:
                readOptionalString(record, ["error", "message"]) ??
                "Account login failed",
            }),
      },
    })
    return out
  }
  if (
    method === "mcp/oauth/completed" ||
    method === "mcpOauth/completed" ||
    method === "mcpServer/oauthLogin/completed"
  ) {
    const record = params as Record<string, unknown>
    out.push({
      ...base(threadId),
      type: "mcp.oauth.completed",
      turnId: readTurnId(params),
      payload: {
        success: record.success === true,
        ...(readOptionalString(params, ["name", "serverName", "server_name"])
          ? {
              name: readOptionalString(params, [
                "name",
                "serverName",
                "server_name",
              ]),
            }
          : {}),
        ...(readOptionalString(params, ["error"])
          ? { error: readOptionalString(params, ["error"]) }
          : {}),
      },
    })
    return out
  }
  if (method === "mcpServer/startupStatus/updated") {
    out.push({
      ...base(threadId),
      type: "mcp.status.updated",
      turnId: readTurnId(params),
      payload: {
        status: params ?? {},
      },
    })
    return out
  }
  if (method === "remoteControl/status/changed") {
    const status = readOptionalString(params, ["status"])
    out.push({
      ...base(threadId),
      type: "session.state.changed",
      status:
        status === "connected" || status === "enabled" ? "running" : "closed",
    })
    return out
  }
  if (method === "app/list/updated") {
    out.push({
      ...base(threadId),
      type: "mcp.status.updated",
      payload: {
        status: { apps: params ?? [] },
      },
    })
    return out
  }
  if (method === "externalAgentConfig/import/completed") {
    out.push({
      ...base(threadId),
      type: "config.warning",
      payload: {
        summary: "External agent config import completed",
        details: "Codex reported imported external agent configuration.",
      },
    })
    return out
  }
  if (method === "fs/changed") {
    out.push({
      ...base(threadId),
      type: "item.updated",
      itemId: readRequestId(params) || randomUUID(),
      kind: "file_change",
      turnId: readTurnId(params),
      payload: {
        itemType: "file_change",
        title: "Filesystem changed",
        data: params,
      },
    })
    return out
  }
  if (
    method === "fuzzyFileSearch/sessionUpdated" ||
    method === "fuzzyFileSearch/sessionCompleted"
  ) {
    const count =
      params &&
      typeof params === "object" &&
      Array.isArray((params as Record<string, unknown>).files)
        ? ((params as Record<string, unknown>).files as unknown[]).length
        : undefined
    out.push({
      ...base(threadId),
      type: "item.updated",
      itemId: readRequestId(params) || randomUUID(),
      kind: "web_search",
      payload: {
        itemType: "web_search",
        title:
          method === "fuzzyFileSearch/sessionCompleted"
            ? "File search completed"
            : "File search updated",
        ...(count !== undefined
          ? { detail: `${count} result${count === 1 ? "" : "s"}` }
          : {}),
        data: params,
      },
    })
    return out
  }

  return null
}
