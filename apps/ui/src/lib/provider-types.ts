/**
 * Shared UI-level provider/model types.
 *
 * Kept outside any component file so extracted UI pieces (ProviderIcon,
 * settings panels, model picker) can all agree on the same shape without
 * pulling in `App.tsx`.
 */

import type {
  ModelCapabilities,
  ProviderAgent,
  ProviderCatalogEntry,
  ProviderInstanceEnvironmentVariable,
  ProviderInstanceAvailability,
  ProviderInstanceStatus,
  ProviderModelCatalog,
  ProviderSkill,
  ProviderSlashCommand,
  ProviderTool,
} from "@betterc0de/schema"

export type OpenAiTransport = "auto" | "api" | "oauth" | "cli"

export type UiProviderModel = {
  id: string
  name: string
  context: string
  tier: string
  isCustom?: boolean
  capabilities?: ModelCapabilities | null
  catalog?: ProviderModelCatalog
}

export type UiProvider = {
  id: string
  name: string
  logo: string
  invertDark?: boolean
  providerKind?: string
  openaiTransport?: OpenAiTransport
  providerInstanceId?: string
  continuationKey?: string
  models: UiProviderModel[]
  /** False while runtime model discovery is pending; fallback entries are not
   * evidence that a persisted model or its reasoning options were removed. */
  modelsReady?: boolean
  providerCatalog?: ReadonlyArray<ProviderCatalogEntry>
  skills?: ReadonlyArray<ProviderSkill>
  agents?: ReadonlyArray<ProviderAgent>
  tools?: ReadonlyArray<ProviderTool>
  slashCommands?: ReadonlyArray<ProviderSlashCommand>
  environment?: ReadonlyArray<ProviderInstanceEnvironmentVariable>
  /** Live setup status surfaced by `useProviderStatus` (sourced from
   *  `GET /providers/status`).
   *
   *  - `undefined` — status not yet fetched (initial mount). The model
   *    picker MUST NOT disable an undefined-status provider — that would
   *    flash every entry as disabled on first paint until the backend
   *    responds.
   *  - `false` — provider lacks credentials / CLI / running server.
   *    Model picker disables the entry and shows `setupHint` on hover.
   *  - `true` — provider is ready to use.
   */
  configured?: boolean
  /** Adapter-reported auth flow kind (`"api-key"`, `"cli"`,
   *  `"local-server"`, `"oauth"`). Used as a fallback tooltip-copy key
   *  when `setupHint` is absent. */
  authType?: string
  /** Adapter-supplied human-readable setup instruction. Wins over the
   *  renderer's per-`authType` default copy. */
  setupHint?: string
  /** Runtime status from provider instances. Non-ready statuses are surfaced
   *  in the chat column so users see provider problems where they happen. */
  status?: ProviderInstanceStatus
  statusMessage?: string
  availability?: ProviderInstanceAvailability
  unavailableReason?: string
}
