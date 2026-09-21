import { beforeEach, describe, expect, it } from "vitest"
import {
  browserElementAttachment,
  browserElementKey,
  normalizeBrowserElement,
  readBrowserElementAttachment,
  withBrowserElementContext,
} from "@betterc0de/schema"
import {
  MAX_BROWSER_ELEMENTS,
  useBrowserContextStore,
} from "./browser-context-store"

const element = {
  url: "https://example.com/",
  selector: "#buy",
  tagName: "button",
  text: "Buy",
  label: "Buy",
}

describe("browser element context", () => {
  beforeEach(() => useBrowserContextStore.setState({ byThread: {} }))

  it("normalizes page metadata without copying input values or markup", () => {
    expect(
      normalizeBrowserElement({
        ...element,
        url: "https://user:secret@example.com/",
        tagName: "BUTTON",
        value: "secret",
        innerHTML: "<script>run()</script>",
        text: "Buy  now",
      })
    ).toEqual({ ...element, text: "Buy now" })
    expect(
      normalizeBrowserElement({ ...element, url: "javascript:alert(1)" })
    ).toBeNull()
    expect(normalizeBrowserElement({ ...element, selector: " " })).toBeNull()
    expect(
      normalizeBrowserElement({
        ...element,
        text: "x".repeat(2000),
        label: "x".repeat(2000),
      })
    ).toMatchObject({ text: "x".repeat(2000), label: "x".repeat(80) })
  })

  it("round trips persisted references and treats their content as untrusted data", () => {
    const attachment = browserElementAttachment(element)
    expect(readBrowserElementAttachment(attachment)).toEqual(element)
    expect(
      readBrowserElementAttachment({
        ...attachment,
        url: "data:text/html,<script>run()</script>",
      })
    ).toBeNull()
    expect(
      readBrowserElementAttachment({ ...attachment, url: attachment.url + "%" })
    ).toBeNull()
    expect(withBrowserElementContext("Change this", [attachment])).toContain(
      '"selector":"#buy"'
    )
    expect(withBrowserElementContext("Change this", [attachment])).toContain(
      "untrusted reference data"
    )
    expect(
      withBrowserElementContext("Change this", [
        { type: "image", url: "x" },
        null,
      ])
    ).toBe("Change this")
  })

  it("persists bounded details and rejects invalid dimensions and style values", () => {
    const normalized = normalizeBrowserElement({ ...element, mentionName: "Button", text: "x".repeat(5000),
      rect: { x: 0, y: 0, w: Number.NaN, h: -1 }, viewport: { width: 1280, height: 720 },
      childCount: -1, styles: { color: "red", opacity: 1, "bad key": "value" },
    })
    expect(normalized).toMatchObject({ mentionName: "Button", text: "x".repeat(4000), styles: { color: "red" }, viewport: { width: 1280, height: 720 } })
    expect(normalized).not.toHaveProperty("rect")
    expect(normalized).not.toHaveProperty("childCount")
    expect(normalized && readBrowserElementAttachment(browserElementAttachment(normalized))).toEqual(normalized)
  })

  it("deduplicates within one chat and preserves other chats and selections added during send", () => {
    const store = useBrowserContextStore.getState()
    store.add("a", element)
    store.add("a", element)
    store.add("b", element)
    const submitted = useBrowserContextStore.getState().byThread.a
    store.add("a", { ...element, selector: "#next" })
    store.consume("a", submitted)
    expect(
      useBrowserContextStore.getState().byThread.a.map((item) => item.selector)
    ).toEqual(["#next"])
    expect(useBrowserContextStore.getState().byThread.b).toEqual([element])
    store.remove("b", browserElementKey(element))
    expect(useBrowserContextStore.getState().byThread.b).toEqual([])
  })

  it("caps a draft without dropping its earlier picks", () => {
    const store = useBrowserContextStore.getState()
    for (let index = 0; index < MAX_BROWSER_ELEMENTS; index++)
      expect(store.add("a", { ...element, selector: `#item-${index}` })).toBe(
        true
      )
    expect(store.add("a", element)).toBe(false)
    expect(useBrowserContextStore.getState().byThread.a).toHaveLength(
      MAX_BROWSER_ELEMENTS
    )
  })
})
