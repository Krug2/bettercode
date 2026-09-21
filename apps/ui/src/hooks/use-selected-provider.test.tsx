import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSelectedProvider } from "./use-selected-provider"
import type { UiProvider } from "@/lib/provider-types"

const effects = vi.hoisted(() => [] as Array<() => unknown>)
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => unknown) => effects.push(effect),
}))

function renderSelection(props: Parameters<typeof useSelectedProvider>[0]) {
  let result!: ReturnType<typeof useSelectedProvider>
  function Probe() {
    result = useSelectedProvider(props)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  for (const effect of effects.splice(0)) effect()
  return result
}

function provider(
  id: string,
  configured?: boolean,
  modelsReady = false
): UiProvider {
  return {
    id,
    name: id,
    logo: "",
    providerKind: id,
    providerInstanceId: id,
    configured,
    modelsReady,
    models: [{ id: `${id}-model`, name: id, context: "test", tier: "test" }],
  }
}

describe("provider fallback persistence", () => {
  beforeEach(() => effects.splice(0))

  it("waits for discovery before replacing a retired API preference with the available CLI", () => {
    const props = {
      providers: [provider("codex"), provider("claude")],
      selectedProviderId: "anthropic",
      selectedModel: "api-model",
      thinkingMode: null,
      setSelectedProviderId: vi.fn(),
      setSelectedModel: vi.fn(),
      setThinkingMode: vi.fn(),
    }
    expect(renderSelection(props).selectedProvider?.id).toBe("claude")
    expect(props.setSelectedProviderId).not.toHaveBeenCalled()
    expect(props.setSelectedModel).not.toHaveBeenCalled()

    props.providers = [provider("codex", true), provider("claude", false)]
    expect(renderSelection(props).selectedProvider?.id).toBe("codex")
    expect(props.setSelectedProviderId).not.toHaveBeenCalled()
    expect(props.setSelectedModel).not.toHaveBeenCalled()

    props.providers = [
      provider("codex", true, true),
      provider("claude", false, true),
    ]
    expect(renderSelection(props).selectedProvider?.id).toBe("codex")
    expect(props.setSelectedProviderId).toHaveBeenCalledExactlyOnceWith("codex")
    expect(props.setSelectedModel).toHaveBeenCalledExactlyOnceWith(
      "codex-model",
      "codex"
    )
  })

  it("does not rewrite an explicit available provider on startup", () => {
    const props = {
      providers: [
        provider("codex", true, true),
        provider("claude", true, true),
      ],
      selectedProviderId: "codex",
      selectedModel: "codex-model",
      thinkingMode: null,
      setSelectedProviderId: vi.fn(),
      setSelectedModel: vi.fn(),
      setThinkingMode: vi.fn(),
    }
    expect(renderSelection(props).selectedProvider?.id).toBe("codex")
    expect(props.setSelectedProviderId).not.toHaveBeenCalled()
    expect(props.setSelectedModel).not.toHaveBeenCalled()
  })
})
