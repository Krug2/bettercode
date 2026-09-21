import { Platform } from "react-native"
import * as SecureStore from "expo-secure-store"
import type { ConnectionProfile } from "@/types/remote"
import { parseConnectionProfile } from "./remote-session"

const STORAGE_KEY = "betterc0de.remote.profile.v1"
let webFallback: string | null = null

export async function readStoredProfile(): Promise<ConnectionProfile | null> {
  const raw = await readValue()
  if (!raw) return null
  try {
    return parseConnectionProfile(JSON.parse(raw))
  } catch {
    await clearStoredProfile()
    return null
  }
}

export async function storeProfile(profile: ConnectionProfile): Promise<void> {
  const raw = JSON.stringify(profile)
  if (Platform.OS === "web") {
    webFallback = raw
    globalThis.localStorage?.setItem(STORAGE_KEY, raw)
    return
  }
  await SecureStore.setItemAsync(STORAGE_KEY, raw, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

export async function clearStoredProfile(): Promise<void> {
  if (Platform.OS === "web") {
    webFallback = null
    globalThis.localStorage?.removeItem(STORAGE_KEY)
    return
  }
  await SecureStore.deleteItemAsync(STORAGE_KEY)
}

async function readValue(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? webFallback
  }
  return SecureStore.getItemAsync(STORAGE_KEY)
}
