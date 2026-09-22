import { describe, expect, it } from "vitest"
import { solveContacts, type ContactBody } from "./blob-contacts"

const body = (id: string, x: number, radius = 50): ContactBody => ({ node: { id, radius }, x, y: 0, scale: 1, phase: 0.5, vx: 0, vy: 0, pressure: { x: 0, y: 0 } })
const push = (body: ContactBody, delta: { x: number; y: number }) => { body.x += delta.x; body.y += delta.y }

describe("soft contacts", () => {
  it("holds the dragged blob while its neighbor yields and both compress", () => {
    const a = body("a", 0), b = body("b", 60)
    for (let frame = 0; frame < 20; frame++) {
      a.pressure = { x: 0, y: 0 }; b.pressure = { x: 0, y: 0 }
      solveContacts([a, b], "a", 0.5, push)
    }
    expect(a.x).toBe(0)
    expect(b.x).toBeGreaterThan(92)
    expect(b.x).toBeLessThan(95)
    expect(a.pressure.x).toBeLessThan(0)
    expect(b.pressure.x).toBeLessThan(0)
  })

  it("moves smaller blobs more and resolves coincident centers without invalid numbers", () => {
    const a = body("a", 0, 100), b = body("b", 70, 40)
    solveContacts([a, b], null, 0.5, push)
    expect(b.x - 70).toBeGreaterThan(Math.abs(a.x) * 5)
    const c = body("c", 0), d = body("d", 0)
    solveContacts([c, d], null, 0.5, push)
    expect(Number.isFinite(c.x + c.y + d.x + d.y)).toBe(true)
    expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeGreaterThan(80)
  })

  it("leaves separated blobs alone", () => {
    const a = body("a", -500), b = body("b", 500)
    expect(solveContacts([a, b], null, 0.5, push)).toBe(0)
    expect(a.x).toBe(-500)
    expect(b.x).toBe(500)
  })
})
