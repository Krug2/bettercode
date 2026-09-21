/**
 * Tool calls fold into one "N steps · 12s" dropdown whose rows reuse the
 * desktop presentation derivation.
 */

import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import type { LucideProps } from "lucide-react-native"
import {
  Check,
  ChevronDown,
  CircleDashed,
  File,
  FolderOpen,
  GitBranch,
  Globe,
  Pencil,
  Search,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react-native"
import {
  describeProviderToolActivity,
  extractToolOutputText,
} from "@betterc0de/schema/tool-activity"
import type { ChatMessage } from "@/types/remote"
import { colors, font, radius, spacing, type } from "@/design/theme"

type ToolCall = NonNullable<ChatMessage["toolCalls"]>[number]

/**
 * Port of the desktop ToolCallGroup: one slim "N steps · 12s" dropdown line
 * that expands into a left-railed timeline of tool rows.
 */
export function ToolCallGroup({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const failed = tools.filter((tool) => tool.state === "output-error").length
  const duration = groupDurationLabel(tools)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tools.length} tool steps, ${open ? "collapse" : "expand"}`}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.disclosureRow,
          pressed && styles.pressed,
        ]}
      >
        {failed > 0 ? (
          <XCircle size={14} color={colors.danger} />
        ) : (
          <Wrench size={14} color={colors.textSecondary} />
        )}
        <Text style={styles.disclosureLabel}>
          {tools.length} {tools.length === 1 ? "step" : "steps"}
        </Text>
        {duration ? <Text style={styles.durationLabel}>{duration}</Text> : null}
        {failed > 0 ? (
          <Text style={styles.failedLabel}>{failed} failed</Text>
        ) : null}
        <ChevronDown
          size={14}
          color={colors.textMuted}
          style={open ? styles.chevronOpen : undefined}
        />
      </Pressable>
      {open ? (
        <View style={styles.toolRail}>
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

/**
 * One tool step, using the same summary/detail derivation as the desktop
 * (`deriveProviderToolActivityPresentation`): "Read file" + `hero.html` chip,
 * per-tool icon, duration and status. Tapping a row with output toggles a
 * mono preview box, mirroring the desktop's inline code preview.
 */
function ToolRow({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const presentation = describeProviderToolActivity({
    toolName: tool.name,
    title: tool.title,
    kind: tool.kind,
    input: tool.input,
    output: tool.output,
    fallbackSummary: tool.name,
  })
  // A file or directory collapses to its name; a pattern or command shows
  // whole, exactly as the desktop row does.
  const detail = presentation.path
    ? lastPathSegment(presentation.path)
    : (presentation.pattern ?? presentation.command ?? presentation.detail ?? "")
  const preview = toolPreview(tool)
  const Icon = toolStepIcon(tool.name, presentation.action)
  const isError = tool.state === "output-error"
  const isDone = tool.state === "output-available" || isError
  const duration =
    typeof tool.durationMs === "number" ? formatDuration(tool.durationMs) : ""
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={presentation.summary}
        onPress={() => preview && setExpanded(!expanded)}
        style={({ pressed }) => [
          styles.toolRow,
          pressed && preview ? styles.pressed : null,
        ]}
      >
        <Icon
          size={13}
          color={isError ? colors.danger : colors.textMuted}
        />
        <Text
          style={[styles.toolSummary, isError && styles.toolSummaryError]}
          numberOfLines={1}
        >
          {presentation.summary}
        </Text>
        {detail ? (
          <View style={styles.toolChip}>
            <Text style={styles.toolChipText} numberOfLines={1}>
              {detail}
            </Text>
          </View>
        ) : null}
        <View style={styles.toolStatus}>
          {duration ? (
            <Text style={styles.toolDuration}>{duration}</Text>
          ) : null}
          {isError ? (
            <XCircle size={12} color={colors.danger} />
          ) : isDone ? (
            <Check size={12} color={colors.success} />
          ) : (
            <CircleDashed size={12} color={colors.textMuted} />
          )}
        </View>
      </Pressable>
      {expanded && preview ? (
        <View style={styles.toolPreview}>
          <Text selectable style={styles.toolPreviewText} numberOfLines={14}>
            {preview}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function lastPathSegment(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized.split("/").pop() || normalized
}

/**
 * Port of the desktop icon choice (lib/tool-step-icon.ts): the classified
 * action decides first, the name heuristic covers the rest.
 */
function toolStepIcon(
  name: string,
  action?: string
): React.ComponentType<LucideProps> {
  switch (action) {
    case "read":
      return File
    case "search":
      return Search
    case "file_change":
      return Pencil
    case "command":
      return Terminal
    case "list":
      return FolderOpen
  }
  const n = name.toLowerCase()
  if (n.includes("search") || n.includes("grep") || n.includes("find")) {
    return Search
  }
  if (n.includes("read") || n.includes("file") || n.includes("cat")) {
    return File
  }
  if (n.includes("write") || n.includes("edit") || n.includes("patch")) {
    return Pencil
  }
  if (
    n.includes("bash") ||
    n.includes("exec") ||
    n.includes("command") ||
    n.includes("shell")
  ) {
    return Terminal
  }
  if (
    n.includes("web") ||
    n.includes("fetch") ||
    n.includes("http") ||
    n.includes("browse")
  ) {
    return Globe
  }
  if (n.includes("git")) return GitBranch
  if (n.includes("list") || n.includes("glob")) return FolderOpen
  return Wrench
}

function toolPreview(tool: ToolCall): string {
  if (tool.error) return tool.error
  if (typeof tool.outputPreview === "string" && tool.outputPreview.trim()) {
    return tool.outputPreview.slice(0, 2000)
  }
  if (typeof tool.output === "string" && tool.output.trim()) {
    return tool.output.slice(0, 2000)
  }
  // The result's text (file lines, stdout, matches), not its envelope.
  const text = extractToolOutputText(tool.output)
  if (text) return text.slice(0, 2000)
  if (tool.output !== undefined && tool.output !== null) {
    try {
      return JSON.stringify(tool.output, null, 2).slice(0, 2000)
    } catch {
      return String(tool.output).slice(0, 2000)
    }
  }
  return ""
}

/** Desktop formatDuration: 812ms → "812ms", 8100 → "8.1s", 95000 → "1m 35s". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

/** Wall-clock span of the turn's tool activity, like the desktop group. */
function groupDurationLabel(tools: ToolCall[]): string {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let hasSum = false
  for (const tool of tools) {
    const started = tool.startedAt ? Date.parse(tool.startedAt) : NaN
    const completed = tool.completedAt ? Date.parse(tool.completedAt) : NaN
    if (Number.isFinite(started)) {
      min = Math.min(min, started)
      max = Math.max(max, started)
    }
    if (Number.isFinite(completed)) {
      min = Math.min(min, completed)
      max = Math.max(max, completed)
    }
    if (typeof tool.durationMs === "number") {
      sum += tool.durationMs
      hasSum = true
    }
  }
  if (min !== Number.POSITIVE_INFINITY && max > min) {
    return `· ${formatDuration(max - min)}`
  }
  if (hasSum && sum > 0) return `· ${formatDuration(sum)}`
  return ""
}

const styles = StyleSheet.create({
  // Shared quiet disclosure rows (reasoning + tool group).
  disclosureRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingRight: spacing.xs,
  },
  disclosureLabel: {
    color: colors.textSecondary,
    fontFamily: font.medium,
    fontSize: 13,
  },
  durationLabel: {
    color: colors.textMuted,
    fontFamily: font.regular,
    fontSize: 11,
  },
  failedLabel: {
    color: colors.danger,
    fontFamily: font.semibold,
    fontSize: 11,
  },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  pressed: { opacity: 0.7 },
  // Tool timeline: left rail + slim rows, like the desktop dropdown.
  toolRail: {
    marginLeft: 6,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    gap: 2,
    paddingBottom: spacing.xs,
  },
  toolRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  toolSummary: {
    flexShrink: 0,
    maxWidth: "50%",
    color: colors.text,
    fontFamily: font.medium,
    fontSize: 12,
  },
  toolSummaryError: { color: colors.danger },
  toolChip: {
    flexShrink: 1,
    minWidth: 0,
    borderRadius: 5,
    backgroundColor: colors.surfaceActive,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  toolChipText: {
    color: colors.textSecondary,
    fontFamily: type.mono,
    fontSize: 10,
  },
  toolStatus: {
    marginLeft: "auto",
    paddingLeft: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  toolDuration: {
    color: colors.textMuted,
    fontFamily: font.regular,
    fontSize: 10,
  },
  toolPreview: {
    marginLeft: 21,
    marginTop: 2,
    marginBottom: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xs,
  },
  toolPreviewText: {
    color: "#D4D4D4",
    fontFamily: type.mono,
    fontSize: 10,
    lineHeight: 15,
  },
})
