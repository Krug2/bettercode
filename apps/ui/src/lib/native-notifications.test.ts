import { describe, expect, it } from "vitest"
import {
  runtimeNotificationFromEvent,
  shouldNotifyForThread,
} from "@/lib/native-notifications"

describe("native notification helpers", () => {
  it("classifies provider approval events as permission notifications", () => {
    expect(
      runtimeNotificationFromEvent("tool_approval_requested", {
        requestId: "req-1",
        toolName: "shell",
        detail: "npm test",
      })
    ).toMatchObject({
      kind: "permissions",
      title: "Approval requested",
      body: "npm test",
      tagSuffix: "approval:req-1",
    })
  })

  it("classifies runtime errors as error notifications", () => {
    expect(
      runtimeNotificationFromEvent("runtime.error", {
        eventId: "evt-1",
        message: "Provider failed",
      })
    ).toMatchObject({
      kind: "errors",
      title: "Provider error",
      body: "Provider failed",
      tagSuffix: "error:evt-1",
    })
  })

  it("notifies only for hidden windows or inactive threads", () => {
    expect(
      shouldNotifyForThread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        visibilityState: "visible",
      })
    ).toBe(false)
    expect(
      shouldNotifyForThread({
        threadId: "thread-1",
        activeThreadId: "thread-2",
        visibilityState: "visible",
      })
    ).toBe(true)
    expect(
      shouldNotifyForThread({
        threadId: "thread-1",
        activeThreadId: "thread-1",
        visibilityState: "hidden",
      })
    ).toBe(true)
  })
})
