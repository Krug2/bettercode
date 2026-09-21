import { Platform } from "react-native"
import { create } from "zustand"
import type { ConnectionProfile } from "@/types/remote"
import { parsePairingInput } from "@/lib/endpoint"
import { pairMobile, remoteApi, RemoteApiError } from "@/lib/remote-api"
import {
  clearStoredProfile,
  readStoredProfile,
  storeProfile,
} from "@/lib/secure-session"

export type ConnectionState =
  | "hydrating"
  | "unpaired"
  | "pairing"
  | "checking"
  | "online"
  | "offline"

export type SocketState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"

interface SessionStore {
  profile: ConnectionProfile | null
  state: ConnectionState
  socketState: SocketState
  error: string | null
  lastCheckedAt: string | null
  hydrate: () => Promise<void>
  pair: (
    input: string,
    manualBaseUrl?: string,
    label?: string
  ) => Promise<ConnectionProfile>
  check: () => Promise<boolean>
  logout: () => Promise<void>
  forget: () => Promise<void>
  setSocketState: (state: SocketState) => void
  setOffline: (message?: string) => void
}

export const useSessionStore = create<SessionStore>((set, get) => {
  // A lifecycle action owns its generation. Awaited work may only commit while
  // that generation is current, including writes to secure storage.
  let generation = 0
  let storageTail: Promise<unknown> = Promise.resolve()
  let pendingCheck: { generation: number; promise: Promise<boolean> } | null =
    null
  const storage = <T>(
    owner: number,
    operation: () => Promise<T>
  ): Promise<T | undefined> => {
    const result = storageTail
      .catch(() => undefined)
      .then(() => (owner === generation ? operation() : undefined))
    storageTail = result
    return result
  }
  const disconnected = (error: string | null = null) =>
    set({
      profile: null,
      state: "unpaired",
      socketState: "idle",
      error,
      lastCheckedAt: null,
    })

  return {
    profile: null,
    state: "hydrating",
    socketState: "idle",
    error: null,
    lastCheckedAt: null,

    hydrate: async () => {
      const owner = ++generation
      set({
        profile: null,
        state: "hydrating",
        socketState: "idle",
        error: null,
      })
      try {
        const profile = await storage(owner, readStoredProfile)
        if (owner !== generation) return
        if (!profile) {
          disconnected()
          return
        }
        set({ profile, state: "checking" })
        await get().check()
      } catch (error) {
        if (owner === generation) disconnected(readableError(error))
      }
    },

    pair: async (input, manualBaseUrl, label) => {
      const owner = ++generation
      set({ profile: null, state: "pairing", socketState: "idle", error: null })
      const assertCurrent = () => {
        if (owner !== generation)
          throw new Error("Pairing was superseded by another session action.")
      }
      try {
        const target = parsePairingInput(input, manualBaseUrl)
        await storage(owner, clearStoredProfile)
        assertCurrent()
        const paired = await pairMobile(
          target.baseUrl,
          target.credential,
          label?.trim() ||
            `${Platform.OS === "ios" ? "iPhone" : "Android"} · BetterC0de`
        )
        assertCurrent()
        const profile: ConnectionProfile = {
          baseUrl: target.baseUrl,
          environmentId: paired.environmentId,
          sessionToken: paired.sessionToken,
          session: paired.session,
          pairedAt: new Date().toISOString(),
        }
        await storage(owner, () => storeProfile(profile))
        assertCurrent()
        set({
          profile,
          state: "online",
          socketState: "connecting",
          error: null,
          lastCheckedAt: new Date().toISOString(),
        })
        return profile
      } catch (error) {
        if (owner === generation) disconnected(readableError(error))
        throw error
      }
    },

    check: () => {
      const owner = generation
      if (pendingCheck?.generation === owner) return pendingCheck.promise
      const profile = get().profile
      if (!profile) {
        disconnected()
        return Promise.resolve(false)
      }
      const current = () => owner === generation
      const check = async (): Promise<boolean> => {
        set({ state: "checking", error: null })
        try {
          const bootstrap = await remoteApi(profile).bootstrap()
          if (!current()) return false
          if (
            !bootstrap.enabled ||
            !bootstrap.authenticated ||
            bootstrap.authentication !== "remote" ||
            bootstrap.environmentId !== profile.environmentId
          ) {
            const invalidation = ++generation
            disconnected(
              "The remote session expired or belongs to a different host."
            )
            await storage(invalidation, clearStoredProfile)
            return false
          }
          const sessionChanged =
            bootstrap.session !== null &&
            JSON.stringify(bootstrap.session) !==
              JSON.stringify(profile.session)
          const refreshed = sessionChanged
            ? { ...profile, session: bootstrap.session! }
            : profile
          if (sessionChanged)
            await storage(owner, () => storeProfile(refreshed))
          if (!current()) return false
          set({
            profile: refreshed,
            state: "online",
            error: null,
            lastCheckedAt: new Date().toISOString(),
          })
          return true
        } catch (error) {
          if (!current()) return false
          if (error instanceof RemoteApiError && error.status === 401) {
            const invalidation = ++generation
            disconnected(error.message)
            await storage(invalidation, clearStoredProfile)
            return false
          }
          set({
            state: "offline",
            error: readableError(error),
            lastCheckedAt: new Date().toISOString(),
          })
          return false
        }
      }
      const promise = check().finally(() => {
        if (pendingCheck?.promise === promise) pendingCheck = null
      })
      pendingCheck = { generation: owner, promise }
      return promise
    },

    logout: async () => {
      const profile = get().profile
      const owner = ++generation
      disconnected()
      await Promise.all([
        storage(owner, clearStoredProfile),
        profile
          ? remoteApi(profile)
              .logout()
              .catch(() => undefined)
          : Promise.resolve(),
      ])
    },

    forget: async () => {
      const owner = ++generation
      disconnected()
      await storage(owner, clearStoredProfile)
    },

    setSocketState: (socketState) => set({ socketState }),
    setOffline: (message) =>
      set({ state: "offline", socketState: "error", error: message ?? null }),
  }
})

function readableError(error: unknown): string {
  if (error instanceof RemoteApiError) {
    if (error.status === 401) return "Pairing code is invalid or expired."
    if (error.status === 403)
      return "Remote Access is turned off on the desktop."
    if (error.status === 429) return "Too many attempts. Wait a moment."
    return error.message
  }
  return error instanceof Error ? error.message : "Connection failed."
}
