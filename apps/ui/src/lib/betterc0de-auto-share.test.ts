import { beforeEach, describe, expect, it } from "vitest"
import type { ChatThread } from "@betterc0de/schema"
import { markBetterC0deAutoShareForThread } from "@/lib/betterc0de-auto-share"
import { getThreadShare } from "@/lib/thread-share"

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

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread-auto-share",
    title: "Auto Share",
    projectName: "BetterC0de",
    projectPath: "/repo",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        content: "Done",
        createdAt: "2026-05-19T10:00:00.000Z",
      },
    ],
    createdAt: "2026-05-19T09:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  }
}

describe("markBetterC0deAutoShareForThread", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("creates a local share marker when BetterC0de share mode is auto", async () => {
    const record = await markBetterC0deAutoShareForThread(thread(), async () => [
      {
        key: "share",
        value: "auto",
        label: "Share",
        kind: "scalar",
        sourcePath: "betterc0de.json#share",
      },
    ])

    expect(record).toMatchObject({
      threadId: "thread-auto-share",
      title: "Auto Share",
      messageCount: 1,
    })
    expect(getThreadShare("thread-auto-share")).toMatchObject({
      threadId: "thread-auto-share",
    })
  })

  it("does not auto-share manual or disabled workspaces", async () => {
    await expect(
      markBetterC0deAutoShareForThread(thread(), async () => [
        {
          key: "share",
          value: "manual",
          label: "Share",
          kind: "scalar",
          sourcePath: "betterc0de.json#share",
        },
      ])
    ).resolves.toBeNull()

    expect(getThreadShare("thread-auto-share")).toBeNull()
  })

  it("creates a local share marker for BETTERC0DE_AUTO_SHARE runtime settings", async () => {
    const record = await markBetterC0deAutoShareForThread(thread(), async () => [
      {
        key: "share",
        value: "manual",
        label: "Share",
        kind: "scalar",
        sourcePath: "betterc0de.json#share",
      },
      {
        key: "runtime.autoShare",
        value: "enabled",
        label: "Runtime auto-share",
        kind: "toggle",
        sourcePath: "BETTERC0DE_AUTO_SHARE#runtime.autoShare",
      },
    ])

    expect(record).toMatchObject({ threadId: "thread-auto-share" })
  })
})
