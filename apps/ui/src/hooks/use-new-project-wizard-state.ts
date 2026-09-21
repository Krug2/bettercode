import { useState } from "react"

export type NewProjectStatus = "idle" | "running" | "done" | "error"

/**
 * Holds the state for the {@link NewProjectDialog} wizard: the open
 * flag, current step, in-progress status + log, plus each form field.
 *
 * Bundled into one hook so App.tsx doesn't have to carry ~10 individual
 * `useState` declarations for what is really a single cohesive piece of
 * UI state. Callers destructure whatever pieces they need.
 */
export function useNewProjectWizardState() {
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectStep, setNewProjectStep] = useState(0)
  const [newProjectName, setNewProjectName] = useState("")
  const [newProjectPath, setNewProjectPath] = useState("")
  const [newProjectPM, setNewProjectPM] = useState<string>("npm")
  const [newProjectTemplate, setNewProjectTemplate] = useState<string | null>(
    null
  )
  const [newProjectUI, setNewProjectUI] = useState<string | null>(null)
  const [newProjectStatus, setNewProjectStatus] =
    useState<NewProjectStatus>("idle")
  const [newProjectLog, setNewProjectLog] = useState("")

  return {
    newProjectOpen,
    setNewProjectOpen,
    newProjectStep,
    setNewProjectStep,
    newProjectName,
    setNewProjectName,
    newProjectPath,
    setNewProjectPath,
    newProjectPM,
    setNewProjectPM,
    newProjectTemplate,
    setNewProjectTemplate,
    newProjectUI,
    setNewProjectUI,
    newProjectStatus,
    setNewProjectStatus,
    newProjectLog,
    setNewProjectLog,
  }
}
