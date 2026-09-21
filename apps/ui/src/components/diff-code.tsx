import { memo, useEffect, useMemo, useState, type CSSProperties } from "react"
import type { ThemedToken } from "shiki"
import {
  buildSplitDiffLines,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
} from "@/lib/git-diff"
import {
  diffChangedRanges,
  highlightDiff,
  type ChangedRange,
  type DiffSyntax,
} from "@/lib/diff-syntax"

export function useDiffSyntax(file?: DiffFile) {
  const [highlighted, setHighlighted] = useState<{
    file: DiffFile
    syntax: DiffSyntax
  } | null>(null)
  useEffect(() => {
    if (!file) return
    let cancelled = false
    void highlightDiff(file)
      .then((syntax) => {
        if (!cancelled) setHighlighted({ file, syntax })
      })
      .catch(() => {
        /* Keep the complete plain-text diff if a grammar cannot load. */
      })
    return () => {
      cancelled = true
    }
  }, [file])
  return highlighted?.file === file ? highlighted?.syntax : undefined
}

export function DiffCodeText({
  content,
  tokens,
  changed,
}: {
  content: string
  tokens?: ThemedToken[]
  changed?: ChangedRange
}) {
  const source = tokens?.length ? tokens : [{ content, offset: 0 }]
  let offset = 0
  return (
    <code className="diff-code-text">
      {source.map((token, index) => {
        const start = offset
        offset += token.content.length
        const markStart = changed
          ? Math.max(0, changed.start - start)
          : token.content.length
        const markEnd = changed
          ? Math.min(token.content.length, changed.end - start)
          : 0
        return (
          <span
            key={index}
            className="diff-token"
            style={
              {
                "--diff-token-light":
                  token.htmlStyle?.color ?? token.color ?? "inherit",
                "--diff-token-dark":
                  token.htmlStyle?.["--shiki-dark"] ?? token.color ?? "inherit",
              } as CSSProperties
            }
          >
            {markEnd > markStart ? (
              <>
                {token.content.slice(0, markStart)}
                <mark className="diff-word-change">
                  {token.content.slice(markStart, markEnd)}
                </mark>
                {token.content.slice(markEnd)}
              </>
            ) : (
              token.content
            )}
          </span>
        )
      })}
      {!content && " "}
    </code>
  )
}

function DiffLineCell({
  line,
  side,
  syntax,
  changed,
}: {
  line: DiffLine | null
  side: "old" | "new" | "unified"
  syntax?: DiffSyntax
  changed?: ChangedRange
}) {
  const revision =
    side === "old" || (side === "unified" && line?.type === "remove")
      ? "old"
      : "new"
  return (
    <div
      className="diff-code-line"
      data-kind={line?.type ?? "empty"}
      data-side={side}
    >
      {(side === "old" || side === "unified") && (
        <span className="diff-line-number" aria-hidden="true">
          {line?.oldNum}
        </span>
      )}
      {(side === "new" || side === "unified") && (
        <span className="diff-line-number" aria-hidden="true">
          {line?.newNum}
        </span>
      )}
      <span className="diff-line-sign" aria-hidden="true">
        {line?.type === "add" ? "+" : line?.type === "remove" ? "−" : ""}
      </span>
      <DiffCodeText
        content={line?.content ?? ""}
        tokens={line ? syntax?.[revision].get(line) : undefined}
        changed={changed}
      />
    </div>
  )
}

export const DiffHunkLines = memo(function DiffHunkLines({
  hunk,
  mode,
  wrap,
  syntax,
}: {
  hunk: DiffHunk
  mode: "unified" | "split"
  wrap: boolean
  syntax?: DiffSyntax
}) {
  const ranges = useMemo(() => diffChangedRanges(hunk.lines), [hunk.lines])
  const pairs = useMemo(
    () => (mode === "split" ? buildSplitDiffLines(hunk.lines) : []),
    [mode, hunk.lines]
  )
  return (
    <div className="diff-code-lines" data-wrap={wrap} data-mode={mode}>
      {mode === "unified"
        ? hunk.lines.map((line, index) => (
            <DiffLineCell
              key={index}
              line={line}
              side="unified"
              syntax={syntax}
              changed={ranges.get(line)}
            />
          ))
        : pairs.map((pair, index) => (
            <div className="diff-code-pair" key={index}>
              <DiffLineCell
                line={pair.left}
                side="old"
                syntax={syntax}
                changed={pair.left ? ranges.get(pair.left) : undefined}
              />
              <DiffLineCell
                line={pair.right}
                side="new"
                syntax={syntax}
                changed={pair.right ? ranges.get(pair.right) : undefined}
              />
            </div>
          ))}
    </div>
  )
})
