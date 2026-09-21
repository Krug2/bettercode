import { type ClipboardEvent, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "./prompt-input"

const captured = vi.hoisted(() => ({ textarea: {} as ComponentProps<"textarea"> }))
vi.mock("@/components/ui/input-group", async original => ({
  ...await original<typeof import("@/components/ui/input-group")>(),
  InputGroupTextarea: (props: ComponentProps<"textarea">) => {
    captured.textarea = props
    return <textarea {...props} />
  },
}))

describe("composer clipboard", () => {
  const add = vi.fn()
  beforeEach(() => {
    add.mockClear()
    function CaptureAttachments() {
      usePromptInputAttachments().add = add
      return <PromptInputTextarea />
    }
    renderToStaticMarkup(<PromptInputProvider><CaptureAttachments /></PromptInputProvider>)
  })

  function paste(text: string, files: File[] = []) {
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: () => text,
        items: [
          { kind: "string", type: "text/plain", getAsFile: () => null },
          ...files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })),
        ],
      },
    }
    captured.textarea.onPaste!(event as unknown as ClipboardEvent<HTMLTextAreaElement>)
    return event
  }

  it.each([
    "first\n  second\nthird\n",
    "x".repeat(20_000),
    "  leading spaces\n\n[Pasted ~3 lines #1]\ntrailing spaces  ",
  ])("lets the browser insert text without replacement or hidden attachments (%#)", text => {
    const event = paste(text)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it("still attaches pasted images instead of inserting their clipboard fallback text", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "screenshot.png", { type: "image/png" })
    const event = paste("image fallback", [file])
    expect(event.preventDefault).toHaveBeenCalledExactlyOnceWith()
    expect(add).toHaveBeenCalledExactlyOnceWith([file])
  })
})
