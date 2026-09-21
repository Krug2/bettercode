import { describe, expect, it } from "vitest"
import { hydrateMessageRow, serializeMessage } from "./thread-codec"

describe("thread message codec", () => {
  it.each([
    "null",
    "false",
    "42",
    '"legacy text"',
    "[]",
    '{"text":42,"extra":null}',
    '{"text":false,"extra":[]}',
  ])("keeps malformed persisted message envelopes readable: %s", (contentJson) => {
    expect(hydrateMessageRow({
      message_id: "malformed-1",
      role: "assistant",
      content_json: contentJson,
      created_at: "2026-07-11T05:00:00.000Z",
    })).toEqual({
      id: "malformed-1",
      role: "assistant",
      content: "",
      createdAt: "2026-07-11T05:00:00.000Z",
    })
  })

  it("preserves valid text when persisted extras are not an object", () => {
    expect(hydrateMessageRow({
      message_id: "text-1",
      role: "assistant",
      content_json: '{"text":"preserved","extra":"invalid"}',
      created_at: "2026-07-11T05:00:00.000Z",
    })).toMatchObject({ content: "preserved" })
  })

  it("round-trips the assistant transcript truncation marker", () => {
    const contentJson = serializeMessage({
      message_id: "assistant-1",
      turn_id: "turn-1",
      role: "assistant",
      content: "bounded output",
      created_at: "2026-07-11T05:00:00.000Z",
      extra: { transcriptTruncated: true },
    })

    expect(
      hydrateMessageRow({
        message_id: "assistant-1",
        turn_id: "turn-1",
        role: "assistant",
        content_json: contentJson,
        created_at: "2026-07-11T05:00:00.000Z",
      })
    ).toEqual(
      expect.objectContaining({
        id: "assistant-1",
        content: "bounded output",
        transcriptTruncated: true,
      })
    )
  })

  it("hydrates durable dispatch lifecycle metadata for the renderer", () => {
    const contentJson = serializeMessage({
      message_id: "user-1",
      turn_id: null,
      role: "user",
      content: "possibly delivered",
      created_at: "2026-07-11T05:00:00.000Z",
      extra: {
        dispatchStatus: "uncertain",
        dispatchFailed: true,
        systemInstructionCharacters: 12_345,
      },
    })

    expect(
      hydrateMessageRow({
        message_id: "user-1",
        role: "user",
        content_json: contentJson,
        created_at: "2026-07-11T05:00:00.000Z",
      })
    ).toMatchObject({
      id: "user-1",
      dispatchStatus: "uncertain",
      dispatchFailed: true,
      systemInstructionCharacters: 12_345,
    })
  })
})
