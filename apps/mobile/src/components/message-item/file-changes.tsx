/**
 * File diffs render as the desktop's FileChangeItem rows (+/− counts,
 * expandable diff lines).
 */

import { useMemo, useState } from "react"
import {
  FILE_CHANGE_PAGE_SIZE,
  FILE_CHANGE_PREVIEW_COUNT,
  groupFileChanges,
} from "@betterc0de/schema"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ChevronDown, File } from "lucide-react-native"
import type { ChatMessage } from "@/types/remote"
import { colors, font, radius, spacing, type } from "@/design/theme"

type MessageDiff = NonNullable<ChatMessage["diffs"]>[number]

/**
 * Port of the desktop FileChangeItem list: bordered card with one row per
 * file — file name + directory, green/red +/− counts, "NEW" pill — and an
 * expandable VS-Code-style diff (− old lines / + new lines) on tap.
 */
export function FileChanges({ diffs }: { diffs: MessageDiff[] }) {
  const grouped = useMemo(() => groupFileChanges(diffs), [diffs])
  const [showGenerated, setShowGenerated] = useState(false)
  return (
    <View style={styles.diffCard}>
      <View style={styles.diffRow}>
        <File size={14} color={colors.textSecondary} />
        <Text style={styles.diffHeading}>{grouped.projectFiles.length} project files</Text>
        <View style={styles.diffStats}>
          {grouped.additions > 0 && <Text style={styles.diffAdd}>+{grouped.additions}</Text>}
          {grouped.deletions > 0 && <Text style={styles.diffDel}>−{grouped.deletions}</Text>}
        </View>
      </View>
      <FileChangeRows diffs={grouped.projectFiles} />
      {grouped.generatedFiles.length > 0 && <>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showGenerated }} onPress={() => setShowGenerated(value => !value)} style={styles.diffDisclosure}>
          <ChevronDown size={13} color={colors.textMuted} style={!showGenerated && styles.chevronClosed} />
          <Text style={styles.diffDisclosureText}>Temporary &amp; generated ({grouped.generatedFiles.length})</Text>
        </Pressable>
        {showGenerated && <FileChangeRows diffs={grouped.generatedFiles} initialLimit={FILE_CHANGE_PAGE_SIZE} />}
      </>}
    </View>
  )
}

function FileChangeRows({ diffs, initialLimit = FILE_CHANGE_PREVIEW_COUNT }: { diffs: MessageDiff[]; initialLimit?: number }) {
  const [limit, setLimit] = useState(initialLimit)
  if (!diffs.length) return null
  return <View>
    <ScrollView nestedScrollEnabled style={styles.diffFileList}>
      {diffs.slice(0, limit).map((diff, index) => (
        <FileChangeRow
          key={`${diff.path}-${index}`}
          diff={diff}
          last={index === Math.min(limit, diffs.length) - 1}
        />
      ))}
    </ScrollView>
    {limit < diffs.length && <Pressable accessibilityRole="button" onPress={() => setLimit(value => value + FILE_CHANGE_PAGE_SIZE)} style={styles.diffDisclosure}>
      <Text style={styles.diffDisclosureText}>Show {Math.min(FILE_CHANGE_PAGE_SIZE, diffs.length - limit)} more ({diffs.length - limit} remaining)</Text>
    </Pressable>}
    {limit > initialLimit && <Pressable accessibilityRole="button" onPress={() => setLimit(initialLimit)} style={styles.diffDisclosure}>
      <Text style={styles.diffDisclosureText}>Show less</Text>
    </Pressable>}
  </View>
}

function FileChangeRow({ diff, last }: { diff: MessageDiff; last: boolean }) {
  const [open, setOpen] = useState(false)
  const normalized = diff.path.replace(/\\/g, "/")
  const fileName = normalized.split("/").pop() || normalized
  const dirPath = normalized.includes("/")
    ? normalized.slice(0, normalized.lastIndexOf("/") + 1)
    : ""
  const hasLines = Boolean(diff.oldText?.trim() || diff.newText?.trim())
  return (
    <View style={!last && styles.diffRowDivider}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Changes in ${fileName}`}
        onPress={() => hasLines && setOpen(!open)}
        style={({ pressed }) => [
          styles.diffRow,
          pressed && hasLines ? styles.pressed : null,
        ]}
      >
        <ChevronDown
          size={13}
          color={hasLines ? colors.textMuted : colors.transparent}
          style={open ? undefined : styles.chevronClosed}
        />
        <File size={14} color={colors.textSecondary} />
        <Text style={styles.diffFileName} numberOfLines={1}>
          {fileName}
        </Text>
        {dirPath ? (
          <Text style={styles.diffDirPath} numberOfLines={1}>
            {dirPath}
          </Text>
        ) : null}
        <View style={styles.diffStats}>
          {diff.additions > 0 ? (
            <Text style={styles.diffAdd}>+{diff.additions}</Text>
          ) : null}
          {diff.deletions > 0 ? (
            <Text style={styles.diffDel}>−{diff.deletions}</Text>
          ) : null}
        </View>
        {diff.isNew ? (
          <View style={styles.newPill}>
            <Text style={styles.newPillText}>NEW</Text>
          </View>
        ) : null}
      </Pressable>
      {open && hasLines ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.diffLines}
        >
          <View>
            {splitLines(diff.oldText).map((line, i) => (
              <View key={`del-${i}`} style={[styles.diffLine, styles.diffLineDel]}>
                <Text style={[styles.diffSign, styles.diffDel]}>−</Text>
                <Text style={styles.diffLineText}>{line}</Text>
              </View>
            ))}
            {splitLines(diff.newText).map((line, i) => (
              <View key={`add-${i}`} style={[styles.diffLine, styles.diffLineAdd]}>
                <Text style={[styles.diffSign, styles.diffAdd]}>+</Text>
                <Text style={styles.diffLineText}>{line}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  )
}

function splitLines(text: string | undefined): string[] {
  if (!text) return []
  return text.split("\n").filter((line) => line.length > 0).slice(0, 80)
}

const styles = StyleSheet.create({
  chevronClosed: { transform: [{ rotate: "-90deg" }] },
  pressed: { opacity: 0.7 },
  // File changes card — desktop FileChangeItem list.
  diffCard: {
    marginTop: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  diffRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  diffRow: {
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  diffFileName: {
    flexShrink: 0,
    maxWidth: "45%",
    color: colors.text,
    fontFamily: font.medium,
    fontSize: 12,
  },
  diffDirPath: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontFamily: font.regular,
    fontSize: 10,
  },
  diffStats: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: spacing.xs,
  },
  diffHeading: { color: colors.text, fontFamily: font.medium, fontSize: 12 },
  diffFileList: { maxHeight: 288 },
  diffDisclosure: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  diffDisclosureText: { color: colors.textSecondary, fontFamily: font.regular, fontSize: 11 },
  diffAdd: {
    color: "#10B981",
    fontFamily: type.mono,
    fontSize: 11,
  },
  diffDel: {
    color: "#F43F5E",
    fontFamily: type.mono,
    fontSize: 11,
  },
  newPill: {
    borderRadius: 4,
    backgroundColor: colors.surfaceActive,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  newPillText: {
    color: colors.textSecondary,
    fontFamily: font.semibold,
    fontSize: 8,
    letterSpacing: 0.8,
  },
  diffLines: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.canvas,
    maxHeight: 260,
  },
  diffLine: {
    flexDirection: "row",
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  diffLineDel: { backgroundColor: "rgba(244,63,94,0.06)" },
  diffLineAdd: { backgroundColor: "rgba(16,185,129,0.06)" },
  diffSign: {
    width: 14,
    fontFamily: type.mono,
    fontSize: 10,
  },
  diffLineText: {
    color: "rgba(250,250,250,0.9)",
    fontFamily: type.mono,
    fontSize: 10,
    lineHeight: 16,
  },
})
