import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const coreApi = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))
const rulesIpc = vi.hoisted(() => ({
  save: vi.fn(),
}))

vi.mock("@/services/backend/coreApi", () => coreApi)
vi.mock("@/services/ipc-facade", () => ({
  ipcApi: {
    rules: rulesIpc,
  },
}))
vi.mock("@/lib/provider-metadata-events", () => ({
  dispatchProviderMetadataChanged: vi.fn(),
}))

import { getCustomRules, saveCustomRules } from "./runtime-config"

describe("backend-owned custom rules", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreApi.getSettings.mockResolvedValue({ custom_rules: "" })
    coreApi.updateSettings.mockResolvedValue({ custom_rules: "" })
    rulesIpc.save.mockResolvedValue(undefined)
    vi.stubGlobal("window", {
      electronAPI: {
        rulesGet: vi.fn().mockResolvedValue({ content: "" }),
        rulesSave: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("prefers settings.custom_rules over the desktop compatibility file", async () => {
    coreApi.getSettings.mockResolvedValue({
      custom_rules: "backend rules",
    })

    await expect(getCustomRules()).resolves.toBe("backend rules")
    expect(window.electronAPI?.rulesGet).not.toHaveBeenCalled()
  })

  it("migrates a legacy rules file when the backend setting is empty", async () => {
    vi.mocked(window.electronAPI!.rulesGet).mockResolvedValue({
      content: "legacy rules",
    })

    await expect(getCustomRules()).resolves.toBe("legacy rules")
    expect(coreApi.updateSettings).toHaveBeenCalledWith({
      custom_rules: "legacy rules",
    })
  })

  it("falls back to the compatibility file while the backend is unavailable", async () => {
    coreApi.getSettings.mockRejectedValue(new Error("backend starting"))
    vi.mocked(window.electronAPI!.rulesGet).mockResolvedValue({
      content: "startup rules",
    })

    await expect(getCustomRules()).resolves.toBe("startup rules")
    expect(coreApi.updateSettings).not.toHaveBeenCalled()
  })

  it("writes the backend setting and mirrors packaged desktop clients", async () => {
    await saveCustomRules("new rules")

    expect(coreApi.updateSettings).toHaveBeenCalledWith({
      custom_rules: "new rules",
    })
    expect(rulesIpc.save).toHaveBeenCalledWith("new rules")
    expect(coreApi.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      rulesIpc.save.mock.invocationCallOrder[0]!
    )
  })

  it("does not require Electron IPC for remote clients", async () => {
    vi.stubGlobal("window", { electronAPI: undefined })

    await saveCustomRules("remote rules")

    expect(coreApi.updateSettings).toHaveBeenCalledWith({
      custom_rules: "remote rules",
    })
    expect(rulesIpc.save).not.toHaveBeenCalled()
  })
})
