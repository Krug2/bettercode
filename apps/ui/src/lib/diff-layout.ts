export const DEFAULT_DIFF_FILE_LIST_WIDTH = 280
export const MIN_DIFF_FILE_LIST_WIDTH = 220

export function maxDiffFileListWidth(panelWidth: number): number {
  return Math.max(MIN_DIFF_FILE_LIST_WIDTH, Math.min(640, panelWidth - 260))
}

export function clampDiffFileListWidth(
  width: number,
  panelWidth: number
): number {
  return Math.min(
    maxDiffFileListWidth(panelWidth),
    Math.max(
      MIN_DIFF_FILE_LIST_WIDTH,
      Number.isFinite(width) ? width : DEFAULT_DIFF_FILE_LIST_WIDTH
    )
  )
}
