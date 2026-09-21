import { Fragment, type ReactNode } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { colors, font, radius, spacing, type } from "@/design/theme"

type Block =
  | { kind: "paragraph" | "quote" | "bullet"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "code"; text: string; language: string }

export function MarkdownText({ content }: { content: string }) {
  return (
    <View style={styles.container}>
      {parseBlocks(content).map((block, index) => {
        if (block.kind === "code") {
          return (
            <View key={index} style={styles.codeShell}>
              {block.language ? (
                <Text style={styles.codeLabel}>{block.language}</Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={styles.code}>
                  {block.text}
                </Text>
              </ScrollView>
            </View>
          )
        }
        if (block.kind === "heading") {
          return (
            <Text
              selectable
              key={index}
              style={[styles.heading, block.level > 2 && styles.headingSmall]}
            >
              {inline(block.text)}
            </Text>
          )
        }
        if (block.kind === "quote") {
          return (
            <View key={index} style={styles.quote}>
              <Text selectable style={styles.quoteText}>
                {inline(block.text)}
              </Text>
            </View>
          )
        }
        if (block.kind === "bullet") {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text selectable style={styles.body}>
                {inline(block.text)}
              </Text>
            </View>
          )
        }
        return (
          <Text selectable key={index} style={styles.body}>
            {inline(block.text)}
          </Text>
        )
      })}
    </View>
  )
}

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let paragraph: string[] = []
  let code: string[] | null = null
  let language = ""
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") })
    paragraph = []
  }
  for (const line of lines) {
    const fence = line.match(/^```\s*([^\s]*)/)
    if (fence) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n"), language })
        code = null
        language = ""
      } else {
        flushParagraph()
        code = []
        language = fence[1] ?? ""
      }
      continue
    }
    if (code) {
      code.push(line)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/)
    if (heading) {
      flushParagraph()
      blocks.push({
        kind: "heading",
        text: heading[2] ?? "",
        level: heading[1]?.length ?? 1,
      })
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)/)
    if (bullet) {
      flushParagraph()
      blocks.push({ kind: "bullet", text: bullet[1] ?? "" })
      continue
    }
    const quote = line.match(/^>\s?(.+)/)
    if (quote) {
      flushParagraph()
      blocks.push({ kind: "quote", text: quote[1] ?? "" })
      continue
    }
    paragraph.push(line)
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n"), language })
  flushParagraph()
  return blocks
}

function inline(value: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={index} style={styles.inlineCode}>
          {part.slice(1, -1)}
        </Text>
      )
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={index} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      )
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  body: {
    flex: 1,
    color: colors.text,
    fontFamily: font.regular,
    fontSize: type.body,
    lineHeight: type.lineHeight,
  },
  bold: { fontFamily: font.bold },
  inlineCode: {
    color: colors.text,
    fontFamily: type.mono,
    fontSize: 14,
    backgroundColor: colors.surfaceActive,
  },
  heading: {
    color: colors.text,
    fontFamily: font.bold,
    fontSize: 19,
    lineHeight: 25,
    marginTop: spacing.xs,
  },
  headingSmall: { fontSize: 16, lineHeight: 22 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingLeft: spacing.sm,
  },
  quoteText: {
    color: colors.textSecondary,
    fontFamily: font.regular,
    fontSize: type.body,
    lineHeight: type.lineHeight,
  },
  bulletRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  bullet: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: type.lineHeight,
  },
  codeShell: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  codeLabel: {
    color: colors.textMuted,
    fontFamily: type.mono,
    fontSize: 11,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    textTransform: "lowercase",
  },
  code: {
    color: "#D4D4D4",
    fontFamily: type.mono,
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.sm,
  },
})
