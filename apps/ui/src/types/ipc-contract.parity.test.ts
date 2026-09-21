/// <reference types="node" />
import { describe, it, expect, vi } from "vitest"
import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as path from "node:path"
import { runInNewContext } from "node:vm"
import { IpcChannel, IpcEvent } from "../../../shell/shared/ipc-contract"

const requireCjs = createRequire(import.meta.url)
const cjs = requireCjs("../../../shell/shared/ipc-contract.cjs") as {
  IpcChannel: Record<string, string>
  IpcEvent: Record<string, string>
}

describe("IPC contract parity between .ts and .cjs", () => {
  it("IpcChannel keys match", () => {
    expect(Object.keys(cjs.IpcChannel).sort()).toEqual(
      Object.keys(IpcChannel).sort()
    )
  })

  it("IpcChannel values match", () => {
    expect(Object.values(cjs.IpcChannel).sort()).toEqual(
      Object.values(IpcChannel).sort()
    )
  })

  it("IpcEvent keys match", () => {
    expect(Object.keys(cjs.IpcEvent).sort()).toEqual(
      Object.keys(IpcEvent).sort()
    )
  })

  it("IpcEvent values match", () => {
    expect(Object.values(cjs.IpcEvent).sort()).toEqual(
      Object.values(IpcEvent).sort()
    )
  })

  it("every channel value matches its key by identity", () => {
    for (const [tsKey, tsValue] of Object.entries(IpcChannel)) {
      expect(cjs.IpcChannel[tsKey]).toBe(tsValue)
    }
    for (const [tsKey, tsValue] of Object.entries(IpcEvent)) {
      expect(cjs.IpcEvent[tsKey]).toBe(tsValue)
    }
  })

  it("executes every preload method against the channel registry and removes only its own listeners", async () => {
    const invoked = new Set<string>()
    const subscribed = new Set<string>()
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    let api: Record<string, unknown> = {}
    runInNewContext(
      fs.readFileSync(
        path.resolve(__dirname, "../../../shell/preload.cjs"),
        "utf8"
      ),
      {
        process: { platform: "win32" },
        navigator: { userActivation: { isActive: true } },
        require: (name: string) => {
          if (name !== "electron")
            throw new Error(`Unexpected preload dependency ${name}`)
          return {
            contextBridge: {
              exposeInMainWorld: (
                name: string,
                value: Record<string, unknown>
              ) => {
                expect(name).toBe("electronAPI")
                api = value
              },
            },
            ipcRenderer: {
              invoke: async (channel: string) => {
                invoked.add(channel)
              },
              on: (channel: string, listener: (...args: unknown[]) => void) => {
                subscribed.add(channel)
                const entries = listeners.get(channel) ?? new Set()
                entries.add(listener)
                listeners.set(channel, entries)
              },
              removeListener: (
                channel: string,
                listener: (...args: unknown[]) => void
              ) => listeners.get(channel)?.delete(listener),
            },
          }
        },
      }
    )
    for (const [name, method] of Object.entries(api)) {
      if (typeof method !== "function") continue
      const callback = vi.fn()
      const result: unknown = await method(callback)
      if (typeof result === "function") {
        const second: unknown = await method(() => undefined)
        const payload = { value: name }
        for (const entries of listeners.values())
          for (const listener of entries) listener({}, payload)
        expect(callback).toHaveBeenCalledWith(payload)
        result()
        expect(
          [...listeners.values()].reduce(
            (count, entries) => count + entries.size,
            0
          )
        ).toBe(1)
        if (typeof second !== "function")
          throw new Error(`Missing unsubscribe for ${name}`)
        second()
      }
    }
    expect([...invoked].sort()).toEqual(Object.values(IpcChannel).sort())
    expect([...subscribed].sort()).toEqual(Object.values(IpcEvent).sort())
    expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(
      true
    )
  })

  it("registers every channel exactly once through the real main/module registration functions", async () => {
    const registered = new Map<string, unknown>()
    const electron = {
      ipcMain: {
        handle: (channel: string, handler: unknown) => {
          expect(registered.has(channel), `duplicate handler: ${channel}`).toBe(
            false
          )
          expect(typeof handler).toBe("function")
          registered.set(channel, handler)
        },
      },
      app: {
        requestSingleInstanceLock: () => true,
        on: vi.fn(),
        whenReady: () => new Promise(() => {}),
        getPath: () => "/test/user",
        commandLine: { appendSwitch: vi.fn() },
      },
      crashReporter: { start: vi.fn() },
      protocol: { registerSchemesAsPrivileged: vi.fn() },
    }
    const modules = new Map<string, { exports: Record<string, unknown> }>()
    const shellDir = path.resolve(__dirname, "../../../shell")
    const registrations = {
      "plugin-ipc.cjs": "registerPluginHandlers",
      "cli-plugins-ipc.cjs": "registerCliPluginHandlers",
      "onboarding-ipc.cjs": "registerOnboardingHandlers",
      "mcp-ipc.cjs": "registerMcpHandlers",
      "skills-ipc.cjs": "registerSkillsHandlers",
      "hooks-ipc.cjs": "registerHooksHandlers",
      "subagents-ipc.cjs": "registerSubagentsHandlers",
      "provider-ipc.cjs": "registerProviderHandlers",
    }
    const executable = new Set([
      "main.cjs",
      ...Object.keys(registrations),
      "shared/ipc-contract.cjs",
      "shared/ipc-envelope.cjs",
      "shared/ipc-handlers-factory.cjs",
      "shared/backend-endpoint.cjs",
    ])
    function load(relative: string): Record<string, unknown> {
      const cached = modules.get(relative)
      if (cached) return cached.exports
      const module = { exports: {} as Record<string, unknown> }
      modules.set(relative, module)
      const filename = path.join(shellDir, relative)
      runInNewContext(
        fs.readFileSync(filename, "utf8"),
        {
          module,
          exports: module.exports,
          __dirname: path.dirname(filename),
          console,
          process: {
            platform: "win32",
            env: {},
            on: vi.fn(),
            resourcesPath: "/test/resources",
            argv: [],
            versions: {},
          },
          require: (name: string) => {
            if (name === "electron") return electron
            if (name === "path" || name === "node:path") return path
            const resolved = path
              .relative(shellDir, path.resolve(path.dirname(filename), name))
              .replaceAll("\\", "/")
            if (executable.has(resolved)) return load(resolved)
            if (resolved === "plugin-manager.cjs")
              return {
                PluginManager: class {
                  plugins = new Map()
                  async loadAllEnabled() {}
                },
              }
            if (resolved === "shared/persist-adapter.cjs")
              return { createArrayPersistAdapter: () => ({}) }
            // Registration must not perform I/O; handlers' dependencies are inert.
            return {}
          },
        },
        { filename }
      )
      return module.exports
    }
    load("main.cjs")
    for (const [file, name] of Object.entries(registrations)) {
      const register = load(file)[name]
      if (typeof register !== "function")
        throw new Error(`Missing registration export ${name}`)
      await register()
    }
    expect([...registered.keys()].sort()).toEqual(
      Object.values(IpcChannel).sort()
    )
  })
})
