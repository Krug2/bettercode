import type { Hono } from "hono"
import { z } from "zod"
import { relayUrl } from "@betterc0de/remote-protocol"
import type { AppState } from "../../appState"
import type { ServerConfig } from "../../config"
import { isLocalOwnerRequest } from "../../remote/http"
import { DeviceRequestError } from "../../remote/relay/http-channel"
import { deviceLabel, devicePermission } from "../../remote/relay/pairing"

export function registerDeviceRoutes(api: Hono, config: ServerConfig, state: AppState): void {
  api.use("/devices/*", async (c, next) => {
    if (!isLocalOwnerRequest(c, config, state)) return c.json({ error: "Manage devices on the local computer" }, 403)
    if (!state.devices) return c.json({ error: "Device linking is unavailable" }, 503)
    c.header("Cache-Control", "no-store")
    try { await next() }
    catch (error) {
      const status = error instanceof DeviceRequestError && [403, 404, 409, 503].includes(error.status) ? error.status as 403 | 404 | 409 | 503 : 400
      return c.json({ error: error instanceof z.ZodError ? "Invalid device settings" : error instanceof Error ? error.message.slice(0, 200) : "Device request failed" }, status)
    }
  })
  api.get("/devices/status", async c => c.json(await state.devices!.status()))
  api.put("/devices/settings", async c => {
    const body = z.object({ enabled: z.boolean(), relayUrl: z.string().max(2048), label: deviceLabel }).parse(await c.req.json())
    const address = body.relayUrl.trim() ? relayUrl(body.relayUrl) : ""
    if (body.enabled && !address) return c.json({ error: "Enter the address of your relay" }, 400)
    await state.settings.updatePublic({ remote_relay_enabled: body.enabled, remote_relay_url: address, remote_device_label: body.label })
    return c.json(await state.devices!.status())
  })
  api.post("/devices/invitations", async c => c.json(await state.devices!.invite()))
  api.post("/devices/link", async c => {
    const body = z.object({ invitation: z.string().max(16_384) }).parse(await c.req.json())
    return c.json(await state.devices!.link(body.invitation))
  })
  api.delete("/devices/link/:id", c => { state.devices!.cancelLink(c.req.param("id")); return c.json({ cancelled: true }) })
  api.post("/devices/approvals/:id", async c => {
    const body = z.object({ approve: z.boolean(), permission: devicePermission.optional() }).parse(await c.req.json())
    if (body.approve && !body.permission) return c.json({ error: "Choose device permissions" }, 400)
    state.devices!.approve(c.req.param("id"), body.approve ? body.permission : undefined)
    return c.json({ approved: body.approve })
  })
  api.delete("/devices/grants/:id", async c => { await state.devices!.revoke(c.req.param("id")); return c.json({ revoked: true }) })
  api.delete("/devices/hosts/:id", async c => { await state.devices!.forget(c.req.param("id")); return c.json({ forgotten: true }) })
}
