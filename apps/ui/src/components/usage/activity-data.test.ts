import { describe, expect, it } from "vitest"
import { activityCells, activityStats, localDate, shiftDate } from "./activity-data"

const day = (date: string, tokens = 10) => ({ date, tokens, calls: 1, cost: null })

describe("usage activity", () => {
  it("keeps calendar days stable across daylight savings and leap years", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29")
    expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09")
    expect(localDate("2026-03-09T01:00:00Z", "America/Chicago")).toBe("2026-03-08")
  })

  it("keeps yesterday's streak active and breaks it after a missed day", () => {
    const days = [day("2026-09-18"), day("2026-09-19"), day("2026-09-20")]
    expect(activityStats(days, "2026-09-21")).toEqual({ current: 3, longest: 3, peak: 10 })
    expect(activityStats(days, "2026-09-22").current).toBe(0)
  })

  it("uses week boundaries and carries earlier history into cumulative totals", () => {
    const days = [day("2024-01-01", 100), day("2026-09-19", 20), day("2026-09-20", 30), day("2026-09-21", 40)]
    const weekly = activityCells(days, "2026-09-21", "weekly")
    expect(weekly).toHaveLength(371)
    expect(weekly.find(cell => cell.date === "2026-09-19")?.value).toBe(20)
    expect(weekly.find(cell => cell.date === "2026-09-20")?.value).toBe(70)
    expect(weekly.find(cell => cell.date === "2026-09-22")?.future).toBe(true)
    expect(activityCells(days, "2026-09-21", "cumulative").find(cell => cell.date === "2026-09-21")?.value).toBe(190)
  })
})
