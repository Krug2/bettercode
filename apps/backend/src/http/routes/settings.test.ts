import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppState } from "../../appState"
import { __resetMasterKeyCache } from "../../settings/crypto"
import { SettingsService } from "../../settings/service"
import { createDeepgramAccessToken, registerSettingsRoutes } from "./settings"

describe("settings routes", () => {
  const dirs: string[] = []

  beforeEach(() => {
    vi.stubEnv("BETTERC0DE_SETTINGS_KEY", Buffer.alloc(32, 13).toString("base64"))
    __resetMasterKeyCache()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    __resetMasterKeyCache()
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  function appWithSettings() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-settings-route-"))
    dirs.push(dir)
    const settings = new SettingsService(path.join(dir, "settings.json"))
    const api = new Hono()
    // The router's auth middleware is not mounted here; the bearer lets
    // the route recognise the desktop owner where a setting is owner-only.
    registerSettingsRoutes(api, {
      settings,
      config: { port: 3773, authToken: "desktop-secret" },
    } as unknown as AppState)
    return { api, settings }
  }
  const desktopHeaders = {
    Authorization: "Bearer desktop-secret",
    "Content-Type": "application/json",
  }

  it("persists the opt-in team configuration and rejects ambiguous or unbounded teams", async () => {
    const { api, settings } = appWithSettings()
    expect(settings.get().orchestrator_enabled).toBe(false)
    const main = { providerKind: "claude", providerInstanceId: "claude", modelId: "fable-test" }
    const worker = { id: "builder", name: "Builder", role: "Implement", providerKind: "codex", providerInstanceId: "codex", modelId: "gpt-6-astra" }
    const team = { main, members: [worker], maxConcurrent: 2, maxTasks: 12 }
    const saved = await api.request("/settings", { method: "PATCH", headers: desktopHeaders, body: JSON.stringify({ patch: { orchestrator_enabled: true, orchestrator_team: team } }) })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ orchestrator_enabled: true, orchestrator_team: team })
    for (const invalid of [{ ...team, maxConcurrent: 5 }, { ...team, members: [worker, worker] }, { ...team, members: [] }]) {
      const result = await api.request("/settings", { method: "PATCH", headers: desktopHeaders, body: JSON.stringify({ patch: { orchestrator_team: invalid } }) })
      expect(result.status).toBe(400)
      expect(settings.get().orchestrator_team).toEqual(team)
    }
  })

  it("returns a typed 400 for a schema-invalid patch", async () => {
    const { api, settings } = appWithSettings()
    const response = await api.request("/settings", {
      method: "PATCH",
      headers: desktopHeaders,
      body: JSON.stringify({ patch: { theme: 42 } }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "invalid_settings_patch",
      error: expect.any(String),
    })
    expect(settings.get().theme).toBe("dark")
  })

  it("explains invalid provider environment fields without exposing their values", async () => {
    const { api } = appWithSettings()
    const response = await api.request("/settings", {
      method: "PATCH", headers: desktopHeaders,
      body: JSON.stringify({ patch: { provider_instances: { personal: { instanceId: "personal", driver: "claude", environment: [{ name: "", value: "private-value" }] } } } }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { code: string; error: string }
    expect(body.code).toBe("invalid_settings_patch")
    expect(body.error).toContain("provider_instances.personal.environment.0.name")
    expect(JSON.stringify(body)).not.toContain("private-value")
  })

  it("accepts the voice dialog's key, microphone and language in one patch", async () => {
    const { api } = appWithSettings()
    const response = await api.request("/settings", {
      method: "PATCH",
      headers: desktopHeaders,
      body: JSON.stringify({ patch: {
        deepgram_api_key: { set: "synthetic-voice-key" },
        voice_mic_device_id: "",
        voice_language: "de",
      } }),
    })
    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(body).toMatchObject({
      deepgram_api_key: { configured: true },
      voice_mic_device_id: "",
      voice_language: "de",
    })
    expect(JSON.stringify(body)).not.toContain("synthetic-voice-key")
  })

  it("names unknown settings fields without returning their values", async () => {
    const { api } = appWithSettings()
    const response = await api.request("/settings", {
      method: "PATCH",
      headers: desktopHeaders,
      body: JSON.stringify({ patch: { unknown_voice_option: "private-value" } }),
    })
    expect(response.status).toBe(400)
    const body: unknown = await response.json()
    expect(body).toMatchObject({
      code: "invalid_settings_patch",
      error: "Invalid settings fields: unknown_voice_option. Check the values and try again.",
    })
    expect(JSON.stringify(body)).not.toContain("private-value")
  })

  it("rejects a non-object patch wrapper", async () => {
    const { api } = appWithSettings()
    const response = await api.request("/settings", {
      method: "PATCH",
      headers: desktopHeaders,
      body: JSON.stringify({ patch: "not-an-object" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.any(String) })
  })

  it("never returns a submitted API key", async () => {
    const { api } = appWithSettings()
    const response = await api.request("/settings", {
      method: "PATCH",
      headers: desktopHeaders,
      body: JSON.stringify({
        patch: { providers: { openai: { api_key: { set: "sk-route" } } } },
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      providers: { openai: { api_key: { configured: true } } },
    })
    expect(JSON.stringify(body)).not.toContain("sk-route")
  })

  it("exchanges the stored Deepgram key for a short-lived renderer token", async () => {
    const { settings } = appWithSettings()
    settings.update({ deepgram_api_key: { set: "stored-deepgram-key" } })
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "temporary-jwt", expires_in: 30 }), {
        status: 200,
        headers: desktopHeaders,
      }),
    )

    await expect(
      createDeepgramAccessToken(settings, request as unknown as typeof fetch),
    ).resolves.toEqual({ accessToken: "temporary-jwt", expiresIn: 30 })
    expect(request).toHaveBeenCalledWith(
      "https://api.deepgram.com/v1/auth/grant",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Token stored-deepgram-key",
        }),
      }),
    )
  })

  it.each(["null", "[]", "not-json", '{"access_token":42}'])(
    "maps an invalid upstream token response to a sanitized gateway error: %s",
    async (body) => {
      const { settings } = appWithSettings()
      settings.update({ deepgram_api_key: { set: "private-key" } })
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
      await expect(createDeepgramAccessToken(settings, request)).rejects.toMatchObject({
        statusCode: 502,
        code: "deepgram_token_invalid",
      })
    }
  )

  it("cancels an unused upstream error response body", async () => {
    const { settings } = appWithSettings()
    settings.update({ deepgram_api_key: { set: "private-key" } })
    const cancel = vi.fn()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      new ReadableStream({ cancel }), { status: 503 }
    ))
    await expect(createDeepgramAccessToken(settings, request)).rejects.toMatchObject({ statusCode: 502 })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
