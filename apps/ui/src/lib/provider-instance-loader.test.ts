import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import { createProviderInstanceLoader } from "./provider-instance-loader"
import {
  listProviderInstanceModels,
  listProviderInstances,
} from "@/services/backend/providersApi"

vi.mock("@/services/backend/providersApi", () => ({
  listProviderInstances: vi.fn(),
  listProviderInstanceModels: vi.fn(),
}))

const snapshot = (modelId?: string) =>
  ({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    configured: true,
    ...(modelId
      ? {
          models: [
            {
              slug: modelId,
              name: modelId,
              isCustom: false,
              capabilities: null,
            },
          ],
        }
      : {}),
  }) as ProviderInstanceSnapshot

describe("provider catalog request ownership", () => {
  beforeEach(() => vi.resetAllMocks())

  it("keeps the newer catalog when an older model lookup finishes last", async () => {
    const entered = Promise.withResolvers<void>()
    const oldModels =
      Promise.withResolvers<
        Awaited<ReturnType<typeof listProviderInstanceModels>>
      >()
    vi.mocked(listProviderInstances)
      .mockResolvedValueOnce([snapshot()])
      .mockResolvedValueOnce([snapshot("gpt-6-astra")])
    vi.mocked(listProviderInstanceModels).mockImplementationOnce(() => {
      entered.resolve()
      return oldModels.promise
    })
    const publish = vi.fn()
    const loader = createProviderInstanceLoader("/a", publish)
    const older = loader.refresh()
    await entered.promise
    await loader.refresh()
    oldModels.resolve([])
    await older
    expect(publish).toHaveBeenCalledExactlyOnceWith([snapshot("gpt-6-astra")])
  })

  it("ignores a previous workspace's pending response after disposal", async () => {
    const pending = Promise.withResolvers<ProviderInstanceSnapshot[]>()
    vi.mocked(listProviderInstances)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce([snapshot("gpt-6-astra")])
    const publish = vi.fn()
    const oldLoader = createProviderInstanceLoader("/a", publish)
    const older = oldLoader.refresh()
    oldLoader.dispose()
    const currentLoader = createProviderInstanceLoader("/b", publish)
    await currentLoader.refresh()
    pending.resolve([snapshot()])
    await older
    await oldLoader.refresh()
    expect(publish).toHaveBeenCalledExactlyOnceWith([snapshot("gpt-6-astra")])
    expect(listProviderInstances).toHaveBeenNthCalledWith(2, "/b")
    expect(listProviderInstances).toHaveBeenCalledTimes(2)
    expect(listProviderInstanceModels).not.toHaveBeenCalled()
  })

  it("preserves metadata during a restart and accepts the recovered catalog", async () => {
    vi.mocked(listProviderInstances)
      .mockResolvedValueOnce([snapshot("gpt-6-astra")])
      .mockRejectedValueOnce(new Error("Backend restarting"))
      .mockResolvedValueOnce([snapshot("gpt-5.6-sol")])
    const publish = vi.fn()
    const loader = createProviderInstanceLoader("/a", publish)
    await loader.refresh()
    await loader.refresh()
    expect(publish).toHaveBeenCalledExactlyOnceWith([snapshot("gpt-6-astra")])
    await loader.refresh()
    expect(publish).toHaveBeenLastCalledWith([snapshot("gpt-5.6-sol")])
  })
})
