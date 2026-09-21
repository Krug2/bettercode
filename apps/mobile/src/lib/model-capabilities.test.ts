import { expect, it } from "vitest"
import type { ModelOption, ProviderInstance } from "@/types/remote"
import { modelOptions } from "./provider-selection"
import {
  thinkingOptionsFor,
  thinkingLabelFor,
  supportsFastMode,
} from "./model-capabilities"

const option: ModelOption = {
  key: "codex-work:model",
  providerKind: "codex",
  providerInstanceId: "codex-work",
  providerLabel: "Codex",
  modelId: "model",
  modelLabel: "Model",
  capabilities: null,
}

it("keeps live capabilities from the remote catalog and uses the advertised effort ladder", () => {
  const instance: ProviderInstance = {
    instanceId: "codex-work",
    driver: "codex",
    enabled: true,
    configured: true,
    installed: true,
    status: "ready",
    availability: "available",
    models: [
      {
        slug: "model",
        name: "Model",
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              type: "select",
              label: "Reasoning",
              options: [{ id: "xhigh", label: "Extra effort" }],
            },
            { id: "fastMode", type: "boolean", label: "Fast" },
          ],
        },
      },
    ],
  }
  const selected = modelOptions([instance])[0]!
  expect(selected.capabilities).toEqual(instance.models[0]!.capabilities)
  expect(thinkingOptionsFor(selected)).toEqual([
    { mode: null, label: "Off" },
    { mode: "xHigh", label: "Extra effort" },
  ])
  expect(supportsFastMode(selected)).toBe(true)
  expect(thinkingLabelFor(thinkingOptionsFor(selected), "extra-high")).toBe(
    "Extra effort"
  )
})

it("provides the shared cold-start Codex ladder without claiming fast-mode support", () => {
  expect(thinkingOptionsFor(option).map((item) => item.mode)).toEqual([
    null,
    "Low",
    "Medium",
    "High",
  ])
  expect(supportsFastMode(option)).toBe(false)
  expect(thinkingOptionsFor(null)).toEqual([])
})
