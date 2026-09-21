import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ForkIntoRepoBadge,
  forkMigrationDescription,
} from "@/components/chat/fork-into-repo-badge"

describe("forkMigrationDescription", () => {
  it("says nothing about files when nothing was copied", () => {
    expect(forkMigrationDescription(null)).toBe(
      "The original chat is still available without a folder."
    )
    expect(
      forkMigrationDescription({ copied: 0, skipped: [], truncated: false })
    ).toBe("The original chat is still available without a folder.")
  })

  it("counts copied and kept files", () => {
    expect(
      forkMigrationDescription({ copied: 1, skipped: [], truncated: false })
    ).toBe("Brought 1 file along.")
    expect(
      forkMigrationDescription({
        copied: 3,
        skipped: ["a.txt", "b.txt"],
        truncated: false,
      })
    ).toBe("Brought 3 files along, kept 2 existing files.")
  })

  // Regression: the backend stops at 5,000 files / 256 MB and reported
  // `truncated`, but the toast never mentioned it — the user believed the
  // whole scratch tree had arrived in the repository.
  it("tells the user when the copy was cut short and where the rest is", () => {
    const text = forkMigrationDescription({
      copied: 5000,
      skipped: [],
      truncated: true,
    })
    expect(text).toContain("Brought 5000 files along.")
    expect(text).toContain("cut short at 5000 files")
    expect(text).toContain("5,000 files / 256 MB")
    expect(text).toContain("left in the scratch workspace")
  })

  // Regression: the "still available without a folder" early return ran
  // before the truncation branch, so a copy that stopped before its first
  // file reported nothing was left behind.
  it("reports truncation even when no file was copied", () => {
    const text = forkMigrationDescription({
      copied: 0,
      skipped: [],
      truncated: true,
    })
    expect(text).toContain("cut short")
    expect(text).toContain("5,000 files / 256 MB")
    expect(text).toContain("scratch workspace")
    expect(text).not.toContain("still available without a folder")
    expect(text).not.toContain("Brought")
  })

  it("does not warn about truncation when the copy completed", () => {
    for (const migrated of [
      { copied: 12, skipped: [], truncated: false },
      // Older backends omit the flag entirely.
      { copied: 12, skipped: [] },
    ]) {
      const text = forkMigrationDescription(migrated)
      expect(text).not.toContain("cut short")
      expect(text).not.toContain("scratch workspace")
    }
  })
})

describe("ForkIntoRepoBadge", () => {
  it("renders an idle badge with its action label", () => {
    const html = renderToStaticMarkup(<ForkIntoRepoBadge threadId="t1" />)
    expect(html).toContain("Fork into repo")
    expect(html).toContain('title="Continue this chat in a repository')
    expect(html).not.toContain("animate-spin")
  })
})
