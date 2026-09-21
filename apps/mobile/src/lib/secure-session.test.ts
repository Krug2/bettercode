import { beforeEach, expect, it, vi } from "vitest"
import * as SecureStore from "expo-secure-store"
import { readStoredProfile, storeProfile } from "./secure-session"

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }))
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
}))

const profile = {
  baseUrl: "https://desktop.test", environmentId: "host", sessionToken: "token",
  pairedAt: "2026-09-20", session: {
    id: "session", label: "Phone", createdAt: "2026-09-20",
    lastSeenAt: "2026-09-20", expiresAt: "2027-09-20",
  },
}

beforeEach(() => vi.resetAllMocks())

it.each([
  null,
  { ...profile, baseUrl: "file:///private" },
  { ...profile, sessionToken: "token\r\nheader" },
  { ...profile, session: { id: "session" } },
  { ...profile, session: { ...profile.session, expiresAt: "invalid" } },
])("clears malformed stored profiles before authentication: %j", async value => {
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(value))
  expect(await readStoredProfile()).toBeNull()
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledOnce()
})

it("reads valid profiles and writes device-only credentials", async () => {
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(profile))
  expect(await readStoredProfile()).toEqual(profile)
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  await storeProfile(profile)
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "betterc0de.remote.profile.v1", JSON.stringify(profile),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  )
})
