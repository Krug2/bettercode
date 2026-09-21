import { describe, expect, it } from "vitest"
import {
  describeSearchTruncationReason,
  searchTruncationMessage,
} from "@/lib/search-truncation"

describe("searchTruncationMessage", () => {
  it("names every cap the backend can report", () => {
    // `services/workspace/search` on the backend: entry walk + content search.
    expect(describeSearchTruncationReason("results")).toBe("result cap")
    expect(describeSearchTruncationReason("visited")).toBe("entry cap")
    expect(describeSearchTruncationReason("limit")).toBe("match cap")
    expect(describeSearchTruncationReason("files")).toBe("file cap")
    expect(describeSearchTruncationReason("bytes")).toBe("size cap")
    expect(describeSearchTruncationReason("deadline")).toBe("time limit")
  })

  // A backend newer than this renderer may add a reason; the notice must
  // still read as a sentence rather than leak an internal token or blank.
  it("falls back to a generic label for an unknown or missing reason", () => {
    expect(describeSearchTruncationReason("something-new")).toBe("cap")
    expect(describeSearchTruncationReason(undefined)).toBe("cap")
    expect(describeSearchTruncationReason("")).toBe("cap")
  })

  it("builds the default one-line notice", () => {
    expect(searchTruncationMessage({ reason: "deadline" })).toBe(
      "Results cut short (time limit) — narrow your search"
    )
    expect(searchTruncationMessage()).toBe(
      "Results cut short (cap) — narrow your search"
    )
  })

  it("lets a surface name what was cut and what to do about it", () => {
    expect(
      searchTruncationMessage({
        subject: "File list",
        reason: "visited",
        hint: "some files may be missing",
      })
    ).toBe("File list cut short (entry cap) — some files may be missing")
  })
})
