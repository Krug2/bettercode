import { describe, expect, it } from "vitest"
import {
  remoteTerminalGrantRevoked,
  remoteTerminalRevocationOwners,
} from "./terminalGrant"

describe("remoteTerminalGrantRevoked", () => {
  it("fires only on the on→off edge of the grant", () => {
    expect(
      remoteTerminalGrantRevoked(
        { remote_access_allow_terminal: true },
        { remote_access_allow_terminal: false }
      )
    ).toBe(true)
    expect(
      remoteTerminalGrantRevoked({ remote_access_allow_terminal: true }, {})
    ).toBe(true)
    expect(
      remoteTerminalGrantRevoked(
        { remote_access_allow_terminal: true },
        { remote_access_allow_terminal: true }
      )
    ).toBe(false)
    expect(
      remoteTerminalGrantRevoked(
        { remote_access_allow_terminal: false },
        { remote_access_allow_terminal: false }
      )
    ).toBe(false)
    expect(
      remoteTerminalGrantRevoked({}, { remote_access_allow_terminal: true })
    ).toBe(false)
  })
})

describe("remoteTerminalRevocationOwners", () => {
  it("addresses every live paired session the way the shell routes register ownership", () => {
    expect(
      remoteTerminalRevocationOwners([
        { id: "session-a" },
        { id: "session-b" },
        { id: "session-a" },
        { id: "" },
      ])
    ).toEqual(["remote:session-a", "remote:session-b"])
    expect(remoteTerminalRevocationOwners([])).toEqual([])
  })
})
