import { beforeEach, expect, it, vi } from "vitest"
import { useSessionStore } from "./session-store"
import { remoteApi, pairMobile, RemoteApiError } from "@/lib/remote-api"
import {
  clearStoredProfile,
  storeProfile,
  readStoredProfile,
} from "@/lib/secure-session"
import type {
  ConnectionProfile,
  RemoteBootstrap,
  RemotePairResponse,
} from "@/types/remote"

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }))
vi.mock("@/lib/secure-session", () => ({
  clearStoredProfile: vi.fn(),
  storeProfile: vi.fn(),
  readStoredProfile: vi.fn(),
}))
vi.mock("@/lib/remote-api", async (original) => ({
  ...(await original<typeof import("@/lib/remote-api")>()),
  remoteApi: vi.fn(),
  pairMobile: vi.fn(),
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function profile(host: string): ConnectionProfile {
  return {
    baseUrl: `https://${host}.test`,
    environmentId: host,
    sessionToken: `${host}-token`,
    pairedAt: "2026-09-19",
    session: {
      id: `${host}-session`,
      label: host,
      createdAt: "2026-09-19",
      lastSeenAt: "2026-09-19",
      expiresAt: "2027-09-19",
    },
  }
}
function bootstrap(p: ConnectionProfile): RemoteBootstrap {
  return {
    enabled: true,
    authenticated: true,
    authentication: "remote",
    environmentId: p.environmentId,
    session: p.session,
  }
}
function mockApi(
  check: Promise<RemoteBootstrap>,
  logout = Promise.resolve({ loggedOut: true })
) {
  vi.mocked(remoteApi).mockReturnValue({
    bootstrap: () => check,
    logout: () => logout,
  } as ReturnType<typeof remoteApi>)
}
async function pair(host: string) {
  const p = profile(host)
  vi.mocked(pairMobile).mockResolvedValue({
    ...bootstrap(p),
    session: p.session,
    environmentId: host,
    sessionToken: p.sessionToken,
    tokenType: "Bearer",
  } as RemotePairResponse)
  return useSessionStore.getState().pair("ABCD-EFGH", p.baseUrl)
}
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(clearStoredProfile).mockResolvedValue()
  vi.mocked(storeProfile).mockResolvedValue()
  await useSessionStore.getState().forget()
  vi.clearAllMocks()
})

it.each(["forget", "logout"] as const)(
  "does not resurrect a session after %s",
  async (method) => {
    const old = profile("old"),
      check = deferred<RemoteBootstrap>()
    useSessionStore.setState({ profile: old, state: "online" })
    mockApi(check.promise)
    const pending = useSessionStore.getState().check()
    await useSessionStore.getState()[method]()
    check.resolve(bootstrap(old))
    expect(await pending).toBe(false)
    expect(useSessionStore.getState()).toMatchObject({
      profile: null,
      state: "unpaired",
      socketState: "idle",
    })
    expect(storeProfile).not.toHaveBeenCalled()
  }
)

it.each(["success", "unauthorized", "expired"])(
  "ignores an old host's %s after a new pairing",
  async (outcome) => {
    const old = profile("old"),
      check = deferred<RemoteBootstrap>()
    useSessionStore.setState({ profile: old, state: "online" })
    mockApi(check.promise)
    const pending = useSessionStore.getState().check()
    const current = await pair("new")
    vi.mocked(clearStoredProfile).mockClear()
    if (outcome === "unauthorized")
      check.reject(new RemoteApiError("expired", 401))
    else
      check.resolve({ ...bootstrap(old), authenticated: outcome !== "expired" })
    expect(await pending).toBe(false)
    expect(useSessionStore.getState()).toMatchObject({
      profile: current,
      state: "online",
    })
    expect(clearStoredProfile).not.toHaveBeenCalled()
  }
)

it("orders secure-storage mutations so an in-flight refresh cannot survive forget", async () => {
  const old = profile("old"),
    write = deferred<void>()
  useSessionStore.setState({ profile: old, state: "online" })
  mockApi(
    Promise.resolve({
      ...bootstrap(old),
      session: { ...old.session, lastSeenAt: "later" },
    })
  )
  const persisted: Array<string> = []
  vi.mocked(storeProfile).mockImplementationOnce(async () => {
    await write.promise
    persisted.push("refresh")
  })
  vi.mocked(clearStoredProfile).mockImplementation(async () => {
    persisted.push("clear")
  })
  const checking = useSessionStore.getState().check()
  await vi.waitFor(() => expect(storeProfile).toHaveBeenCalledOnce())
  const forgetting = useSessionStore.getState().forget()
  expect(useSessionStore.getState().profile).toBeNull()
  expect(clearStoredProfile).not.toHaveBeenCalled()
  write.resolve()
  await Promise.all([checking, forgetting])
  expect(persisted).toEqual(["refresh", "clear"])
  expect(useSessionStore.getState().profile).toBeNull()
})

it("ignores hydration that completes after a new pairing", async () => {
  const reading = deferred<ConnectionProfile | null>()
  vi.mocked(readStoredProfile).mockReturnValueOnce(reading.promise)
  const hydrating = useSessionStore.getState().hydrate()
  await vi.waitFor(() => expect(readStoredProfile).toHaveBeenCalledOnce())
  const pairing = pair("new")
  reading.resolve(profile("old"))
  const current = await pairing
  await hydrating
  expect(useSessionStore.getState()).toMatchObject({
    profile: current,
    state: "online",
  })
  expect(remoteApi).not.toHaveBeenCalled()
})

it("deduplicates concurrent checks in the same session", async () => {
  const old = profile("old"),
    check = deferred<RemoteBootstrap>()
  useSessionStore.setState({ profile: old, state: "online" })
  mockApi(check.promise)
  const first = useSessionStore.getState().check(),
    second = useSessionStore.getState().check()
  expect(remoteApi).toHaveBeenCalledOnce()
  check.resolve(bootstrap(old))
  expect(await Promise.all([first, second])).toEqual([true, true])
})

it("does not publish a pairing that finishes after forget", async () => {
  const response = deferred<RemotePairResponse>(),
    p = profile("old")
  vi.mocked(pairMobile).mockReturnValueOnce(response.promise)
  const pairing = useSessionStore.getState().pair("ABCD-EFGH", p.baseUrl)
  const rejected = expect(pairing).rejects.toThrow("superseded")
  await vi.waitFor(() => expect(pairMobile).toHaveBeenCalledOnce())
  await useSessionStore.getState().forget()
  response.resolve({
    ...bootstrap(p),
    session: p.session,
    environmentId: p.environmentId,
    sessionToken: p.sessionToken,
    tokenType: "Bearer",
  } as RemotePairResponse)
  await rejected
  expect(storeProfile).not.toHaveBeenCalled()
  expect(useSessionStore.getState().profile).toBeNull()
})

it("does not clear a new pairing when an old host's logout finally completes", async () => {
  const old = profile("old"),
    logout = deferred<{ loggedOut: boolean }>()
  useSessionStore.setState({ profile: old, state: "online" })
  mockApi(Promise.resolve(bootstrap(old)), logout.promise)
  const loggingOut = useSessionStore.getState().logout()
  const current = await pair("new")
  logout.resolve({ loggedOut: true })
  await loggingOut
  expect(useSessionStore.getState()).toMatchObject({
    profile: current,
    state: "online",
  })
  expect(storeProfile).toHaveBeenLastCalledWith(current)
})
