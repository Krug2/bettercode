import { describe, expect, it } from "vitest"
import {
  InMemoryMetrics,
  observeAsync,
  RPC_REQUEST_DURATION_MS,
  RPC_REQUESTS_TOTAL,
} from "./metrics"

function findMetric(
  metrics: InMemoryMetrics,
  name: string,
  attributes: Readonly<Record<string, string>>,
) {
  return metrics.snapshot().find(
    (snapshot) =>
      snapshot.name === name &&
      Object.entries(attributes).every(
        ([key, value]) => snapshot.attributes[key] === value,
      ),
  )
}

describe("InMemoryMetrics", () => {
  it("hard-caps cardinality and folds new labels into an overflow series", () => {
    const metrics = new InMemoryMetrics({ maxSeries: 3 })

    for (let index = 0; index < 100; index += 1) {
      metrics.incrementCounter("requests", {
        path: `/threads/${index}-${"x".repeat(200)}`,
      })
    }

    const snapshots = metrics.snapshot()
    expect(snapshots).toHaveLength(3)
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        name: "requests",
        attributes: { overflow: "true" },
        value: 97,
      }),
    )
    expect(
      snapshots.every((snapshot) =>
        Object.values(snapshot.attributes).every((value) => value.length <= 128)
      )
    ).toBe(true)
  })

  it("records async success counters and durations", async () => {
    const metrics = new InMemoryMetrics()
    let time = 100

    await expect(
      observeAsync(
        {
          counterName: RPC_REQUESTS_TOTAL,
          timerName: RPC_REQUEST_DURATION_MS,
          attributes: { method: "rpc.success" },
          metrics,
          now: () => {
            time += 25
            return time
          },
        },
        async () => "ok",
      ),
    ).resolves.toBe("ok")

    expect(
      findMetric(metrics, RPC_REQUESTS_TOTAL, {
        method: "rpc.success",
        outcome: "success",
      }),
    ).toMatchObject({ type: "counter", value: 1 })
    expect(
      findMetric(metrics, RPC_REQUEST_DURATION_MS, { method: "rpc.success" }),
    ).toMatchObject({ type: "timer", count: 1, sumMs: 25 })
  })

  it("records failure outcomes and rethrows", async () => {
    const metrics = new InMemoryMetrics()
    await expect(
      observeAsync(
        {
          counterName: RPC_REQUESTS_TOTAL,
          timerName: RPC_REQUEST_DURATION_MS,
          attributes: { method: "rpc.failure" },
          metrics,
          now: () => 1,
        },
        async () => {
          throw new Error("boom")
        },
      ),
    ).rejects.toThrow("boom")

    expect(
      findMetric(metrics, RPC_REQUESTS_TOTAL, {
        method: "rpc.failure",
        outcome: "failure",
      }),
    ).toMatchObject({ type: "counter", value: 1 })
  })

  it("evaluates lazy attributes after the wrapped function runs", async () => {
    const metrics = new InMemoryMetrics()
    let method = "before"

    await observeAsync(
      {
        counterName: RPC_REQUESTS_TOTAL,
        attributes: () => ({ method }),
        metrics,
        now: () => 1,
      },
      async () => {
        method = "after"
      },
    )

    expect(
      findMetric(metrics, RPC_REQUESTS_TOTAL, {
        method: "after",
        outcome: "success",
      }),
    ).toMatchObject({ type: "counter", value: 1 })
  })
})
