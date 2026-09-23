import { invoke } from "./runtime"

export interface DevicePermission { accessLevel: "full" | "read_only"; allowTerminal: boolean }
export interface DeviceApproval { id: string; peerId: string; label: string; code: string; expiresAt: string }
export interface DeviceLink { id: string; hostId: string; label: string; code: string; status: "connecting" | "waiting" | "linked" | "error"; error?: string }
export interface DeviceHost { id: string; label: string; environmentId: string; relayUrl: string; accessLevel: "full" | "read_only"; expiresAt: string; state: "online" | "connecting" | "offline"; error?: string }
export interface DeviceStatus {
  id: string; label: string; enabled: boolean; persistent: boolean; relayUrl: string; state: string; error?: string;
  pending: DeviceApproval[]; links: DeviceLink[]; hosts: DeviceHost[];
  grants: Array<DevicePermission & { id: string; label: string; expiresAt: string; active: boolean }>
}

export const getDevices = () => invoke<DeviceStatus>("/devices/status")
export const saveDeviceSettings = (body: { enabled: boolean; relayUrl: string; label: string }) => invoke<DeviceStatus>("/devices/settings", { method: "PUT", body })
export const inviteDevice = () => invoke<{ code: string; expiresAt: string }>("/devices/invitations", { method: "POST" })
export const linkDevice = (invitation: string) => invoke<DeviceLink>("/devices/link", { method: "POST", body: { invitation } })
export const cancelDeviceLink = (id: string) => invoke(`/devices/link/${encodeURIComponent(id)}`, { method: "DELETE" })
export const approveDevice = (id: string, permission?: DevicePermission) => invoke(`/devices/approvals/${encodeURIComponent(id)}`, { method: "POST", body: { approve: Boolean(permission), permission } })
export const revokeDevice = (id: string) => invoke(`/devices/grants/${encodeURIComponent(id)}`, { method: "DELETE" })
export const forgetDevice = (id: string) => invoke(`/devices/hosts/${encodeURIComponent(id)}`, { method: "DELETE" })
export async function openDevice(id: string): Promise<void> {
  if (!window.electronAPI?.deviceOpen) throw new Error("open linked devices from the desktop app")
  const result = await window.electronAPI.deviceOpen(id)
  if (!result.ok) throw new Error(result.error || "could not open this device")
}
