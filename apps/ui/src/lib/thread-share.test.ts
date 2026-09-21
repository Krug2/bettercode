import { describe, expect, it, beforeEach } from "vitest"
import {
  buildThreadShareMarkdown,
  clearThreadShare,
  getThreadShare,
  markThreadShared,
} from "@/lib/thread-share"
import type { ChatMessage, ChatThread } from "@betterc0de/schema"

if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map<string, string>()
  ;(
    globalThis as unknown as {
      localStorage: Pick<
        Storage,
        "clear" | "getItem" | "removeItem" | "setItem"
      >
    }
  ).localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => {
      storage.delete(key)
    },
    setItem: (key, value) => {
      storage.set(key, value)
    },
  }
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    role: overrides.role ?? "user",
    content: overrides.content ?? "",
    createdAt: overrides.createdAt ?? "2026-05-19T10:00:00.000Z",
    ...overrides,
  }
}

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread-1",
    title: "Share Test",
    projectName: "BetterC0de",
    projectPath: "/repo",
    messages: [],
    createdAt: "2026-05-19T09:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  }
}

describe("thread-share", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("builds a markdown transcript with metadata, messages, tools, and diffs", () => {
    const markdown = buildThreadShareMarkdown(
      thread({
        messages: [
          message({ role: "user", content: "Build the thing" }),
          message({
            role: "assistant",
            content: "Done",
            modelId: "gpt-5.5",
            toolCalls: [
              {
                id: "tool-1",
                name: "Edit",
                input: { path: "src/app.ts" },
                outputPreview: "patched",
                state: "output-available",
              },
            ],
            diffs: [
              {
                path: "src/app.ts",
                additions: 4,
                deletions: 1,
                oldText: "",
                newText: "",
                isNew: false,
              },
            ],
          }),
        ],
      })
    )

    expect(markdown).toContain("# Share Test")
    expect(markdown).toContain("| Workspace | /repo |")
    expect(markdown).toContain("### 1. User")
    expect(markdown).toContain("Build the thing")
    expect(markdown).toContain("`Edit`")
    expect(markdown).toContain("`src/app.ts` (+4/-1)")
  })

  it("stores and clears local share records by thread id", () => {
    const record = markThreadShared({
      threadId: "thread-1",
      title: "Share Test",
      messageCount: 2,
      transcript: "hello world",
      sharedAt: "2026-05-19T10:30:00.000Z",
    })

    expect(record.transcriptFingerprint).toContain("v1:")
    expect(getThreadShare("thread-1")).toMatchObject({
      title: "Share Test",
      messageCount: 2,
      sharedAt: "2026-05-19T10:30:00.000Z",
    })
    expect(clearThreadShare("thread-1")).toMatchObject({
      title: "Share Test",
    })
    expect(getThreadShare("thread-1")).toBeNull()
  })
})
