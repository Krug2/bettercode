import { describe, expect, it } from "vitest"
import { isAllowedBrowserOrigin, parseAllowedOrigins } from "./origin"

describe("backend browser origin policy", () => {
  it("allows loopback and opaque Electron origins only behind process auth", () => {
    expect(isAllowedBrowserOrigin("http://localhost:5173")).toBe(false)
    expect(
      isAllowedBrowserOrigin("http://localhost:5173", [], {
        allowLoopback: true,
      })
    ).toBe(true)
    expect(isAllowedBrowserOrigin("null")).toBe(false)
    expect(isAllowedBrowserOrigin("null", [], { allowOpaque: true })).toBe(true)
    expect(isAllowedBrowserOrigin("file://", [], { allowOpaque: true })).toBe(true)
  })

  it("rejects arbitrary browser origins unless explicitly configured", () => {
    expect(isAllowedBrowserOrigin("https://attacker.example")).toBe(false)
    expect(
      isAllowedBrowserOrigin("https://remote.example/app", [
        "https://remote.example",
      ])
    ).toBe(true)
  })

  it("parses the explicit remote-origin environment format", () => {
    expect(
      parseAllowedOrigins(" https://one.example,https://two.example ,, ")
    ).toEqual(["https://one.example", "https://two.example"])
  })

  it("allows an exact backend-served origin only when remote hosting is enabled", () => {
    const request = { requestHost: "192.168.1.40:3773", allowSameHost: true }
    expect(isAllowedBrowserOrigin("http://192.168.1.40:3773", [], request)).toBe(true)
    expect(
      isAllowedBrowserOrigin("http://192.168.1.41:3773", [], request)
    ).toBe(false)
    expect(
      isAllowedBrowserOrigin("http://192.168.1.40:3773", [], {
        ...request,
        allowSameHost: false,
      })
    ).toBe(false)
  })

  it("does not treat a different loopback port as the hosted origin", () => {
    expect(
      isAllowedBrowserOrigin("http://127.0.0.1:5173", [], {
        requestHost: "127.0.0.1:3773",
        allowSameHost: true,
      })
    ).toBe(false)
  })
})
