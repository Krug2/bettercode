/**
 * Brand/utility icons for the "Open in" menus, keyed by open-target id
 * (see backend services/openTargets.ts). Cursor / VS Code / Zed SVGs
 * moved verbatim out of chat-toolbar.tsx so both menus share them.
 * Unknown ids fall back to a generic external-link glyph, so new backend
 * targets render without a frontend change.
 */

import {
  ExternalLinkIcon,
  FolderIcon,
  TerminalIcon,
} from "lucide-react"
import { assetUrl } from "@/lib/asset-url"
import { cn } from "@/lib/utils"

function CursorLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  )
}

function VsCodeLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none">
      <mask
        id="open-target-vsc"
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="100"
        height="100"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M70.912 99.317a4.462 4.462 0 0 0 4.96-.19l20.589-9.907A4.462 4.462 0 0 0 100 83.587V16.413a4.462 4.462 0 0 0-3.539-5.633L75.872.874a4.462 4.462 0 0 0-6.36.573c-.261.19-.51.403-.744.637L29.355 38.042 12.187 25.01a2.968 2.968 0 0 0-5.318.236l-5.506 5.009c-1.816 1.651-1.818 4.508-.005 6.162L16.247 50 1.359 63.583c-1.813 1.654-1.811 4.511.005 6.162l5.506 5.009a2.968 2.968 0 0 0 5.318.236l17.167-13.032L68.77 97.917c.623.624 1.355 1.094 2.143 1.4ZM75.015 27.3 45.109 50l29.906 22.701V27.3Z"
          fill="#fff"
        />
      </mask>
      <g mask="url(#open-target-vsc)">
        <path
          d="M96.461 10.796 75.857.876a4.462 4.462 0 0 0-7.107 1.207L1.299 63.583c-1.814 1.654-1.812 4.51.004 6.162l5.51 5.009 5.32.236L93.361 13.37c2.725-2.067 6.639-.124 6.639 3.297v-.24a4.462 4.462 0 0 0-3.539-5.63Z"
          fill="#0065A9"
        />
        <path
          d="M96.461 89.204 75.857 99.124a4.462 4.462 0 0 1-7.107-1.207L1.299 36.417c-1.814-1.654-1.812-4.51.004-6.162l5.51-5.009a2.968 2.968 0 0 1 5.32 1.763l81.227 61.621c2.725 2.067 6.639.124 6.639-3.297v.24a4.462 4.462 0 0 1-3.539 5.63Z"
          fill="#007ACC"
        />
        <path
          d="M75.858 99.126a4.462 4.462 0 0 1-7.108-1.21c2.306 2.307 6.25.67 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.59a4.462 4.462 0 0 1 7.108 1.21l20.6 9.488A4.462 4.462 0 0 1 100 16.413v67.174a4.462 4.462 0 0 1-3.541 4.632l-20.6 9.907Z"
          fill="#1F9CF0"
        />
      </g>
    </svg>
  )
}

function ZedLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z" />
    </svg>
  )
}

/** Simple orbit-ring "A" mark — no official asset shipped for v1. */
function AntigravityLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="4.5" />
      <ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(-24 12 12)" />
    </svg>
  )
}

/** Minimal Android robot head. */
function AndroidStudioLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.6 11.48a6.02 6.02 0 0 0-2.19-2.62l1.24-2.14a.4.4 0 0 0-.15-.55.4.4 0 0 0-.55.15l-1.26 2.17A6 6 0 0 0 12 8a6 6 0 0 0-2.69.49L8.05 6.32a.4.4 0 0 0-.55-.15.4.4 0 0 0-.15.55l1.24 2.14A6.02 6.02 0 0 0 6 14h12a5.97 5.97 0 0 0-.4-2.52ZM9.5 12.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm5 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
    </svg>
  )
}

export function OpenTargetIcon({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const cls = cn("shrink-0", className)
  switch (id) {
    case "vscode":
      return <VsCodeLogo className={cls} />
    case "cursor":
      return <CursorLogo className={cls} />
    case "zed":
      return <ZedLogo className={cls} />
    case "antigravity":
      return <AntigravityLogo className={cls} />
    case "android-studio":
      return <AndroidStudioLogo className={cls} />
    case "github-desktop":
      return (
        <img
          src={assetUrl("icons/services/github.svg")}
          alt=""
          className={cn(cls, "dark:invert")}
        />
      )
    case "git-bash":
      return <img src={assetUrl("icons/shells/git.svg")} alt="" className={cls} />
    case "wsl":
      return (
        <img src={assetUrl("icons/shells/linux.svg")} alt="" className={cls} />
      )
    case "explorer":
      return <FolderIcon className={cls} strokeWidth={1.75} />
    case "terminal":
      return <TerminalIcon className={cls} strokeWidth={1.75} />
    default:
      return <ExternalLinkIcon className={cls} strokeWidth={1.75} />
  }
}
