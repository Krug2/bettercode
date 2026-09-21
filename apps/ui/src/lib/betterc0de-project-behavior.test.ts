import { describe, expect, it } from "vitest"
import {
  DEFAULT_BETTERC0DE_IMAGE_ATTACHMENT_POLICY,
  imageAttachmentPolicyFromProjectConfig,
} from "@/lib/betterc0de-project-behavior"

describe("BetterC0de project behavior", () => {
  it("maps BetterC0de image attachment config to composer limits", () => {
    expect(
      imageAttachmentPolicyFromProjectConfig([
        { key: "attachment.image.auto_resize", value: "false" },
        { key: "attachment.image.max_width", value: "1200" },
        { key: "attachment.image.max_height", value: "900" },
        { key: "attachment.image.max_base64_bytes", value: "123456" },
      ])
    ).toEqual({
      autoResize: false,
      maxWidth: 1200,
      maxHeight: 900,
      maxBase64Bytes: 123456,
    })
  })

  it("uses BetterC0de image attachment defaults for missing or invalid values", () => {
    expect(
      imageAttachmentPolicyFromProjectConfig([
        { key: "attachment.image.max_width", value: "0" },
        { key: "attachment.image.max_height", value: "not-a-number" },
      ])
    ).toEqual(DEFAULT_BETTERC0DE_IMAGE_ATTACHMENT_POLICY)
  })
})
