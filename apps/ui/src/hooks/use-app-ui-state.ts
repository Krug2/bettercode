import { useCallback, useState } from "react"
import type { ConfirmAction } from "@/components/dialogs/confirm-action-dialog"
import { useApprovalModalStore } from "@/lib/approval-modal-store"
import { useChatStore } from "@/lib/chat-store"
import {
  normalizePlanModalInput,
  type PlanModalInput,
  type SourceProposedPlanReference,
} from "@/lib/plan-modal"

export type SystemBrowserIntent = "agent-new-thread" | "editor-open-folder"

/**
 * Bundles every transient UI state that App.tsx owns: modal open flags,
 * search/filter inputs, one-off text buffers, the global
 * confirm-action payload.
 *
 * These don't belong in the persisted `preferences` store (they're
 * ephemeral per-session), and they don't belong in any feature-specific
 * zustand store either (they're cross-cutting app-level chrome state).
 * Keeping them here in one hook reduces the App.tsx header by ~15
 * `useState` declarations and keeps the "what UI panels are open?"
 * surface area in one file.
 *
 * Note: `composerTabs`, `newProjectWizard`, `voiceInput` are their own
 * dedicated hooks because they own more than just open/close state —
 * only the thin one-shot modal flags live here.
 */
export function useAppUiState() {
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState("general")
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [chatSearch, setChatSearch] = useState("")
  const [chatDateFilter, setChatDateFilter] = useState("all")
  const [planModalContent, setPlanModalContentState] = useState<string | null>(
    null
  )
  const [planModalSourceProposedPlan, setPlanModalSourceProposedPlan] =
    useState<SourceProposedPlanReference | null>(null)
  const [planModalImplemented, setPlanModalImplemented] = useState(false)
  const [planModalThreadId, setPlanModalThreadId] = useState<string | null>(null)
  const setPlanModalContent = useCallback((input: PlanModalInput) => {
    const payload = normalizePlanModalInput(input)
    setPlanModalThreadId(payload
      ? payload.sourceProposedPlan?.threadId ?? (payload.threadId === undefined ? useChatStore.getState().activeThreadId : payload.threadId)
      : null)
    setPlanModalContentState(payload?.content ?? null)
    setPlanModalSourceProposedPlan(payload?.sourceProposedPlan ?? null)
    setPlanModalImplemented(Boolean(payload?.implemented))
    // Same tick as the state write, so there's no frame where the approval
    // modal could mount on top of the plan dialog.
    useApprovalModalStore.getState().setPlanModalOpen(payload !== null)
  }, [])
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [editorModeModalOpen, setEditorModeModalOpen] = useState(false)
  const [editorModalPath, setEditorModalPath] = useState("")
  const [newThreadModalOpen, setNewThreadModalOpen] = useState(false)
  const [newThreadModalPath, setNewThreadModalPath] = useState("")
  const [fileExplorerModal, setFileExplorerModal] = useState(false)
  const [fileTreeSidebar, setFileTreeSidebar] = useState(true)
  const [gitModal, setGitModal] = useState(false)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [goToLineOpen, setGoToLineOpen] = useState(false)
  const [documentSymbolsOpen, setDocumentSymbolsOpen] = useState(false)
  const [workspaceSymbolsOpen, setWorkspaceSymbolsOpen] = useState(false)
  const [autonomousDialogOpen, setAutonomousDialogOpen] = useState(false)
  const [systemBrowserOpen, setSystemBrowserOpen] = useState(false)
  const [systemBrowserIntent, setSystemBrowserIntent] =
    useState<SystemBrowserIntent>("agent-new-thread")

  return {
    modelModalOpen,
    setModelModalOpen,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    editingFile,
    setEditingFile,
    chatSearch,
    setChatSearch,
    chatDateFilter,
    setChatDateFilter,
    planModalContent,
    planModalSourceProposedPlan,
    planModalThreadId,
    planModalImplemented,
    setPlanModalContent,
    confirmAction,
    setConfirmAction,
    editorModeModalOpen,
    setEditorModeModalOpen,
    editorModalPath,
    setEditorModalPath,
    newThreadModalOpen,
    setNewThreadModalOpen,
    newThreadModalPath,
    setNewThreadModalPath,
    fileExplorerModal,
    setFileExplorerModal,
    fileTreeSidebar,
    setFileTreeSidebar,
    gitModal,
    setGitModal,
    marketplaceOpen,
    setMarketplaceOpen,
    shortcutsOpen,
    setShortcutsOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    quickOpenOpen,
    setQuickOpenOpen,
    goToLineOpen,
    setGoToLineOpen,
    documentSymbolsOpen,
    setDocumentSymbolsOpen,
    workspaceSymbolsOpen,
    setWorkspaceSymbolsOpen,
    autonomousDialogOpen,
    setAutonomousDialogOpen,
    systemBrowserOpen,
    setSystemBrowserOpen,
    systemBrowserIntent,
    setSystemBrowserIntent,
  }
}
