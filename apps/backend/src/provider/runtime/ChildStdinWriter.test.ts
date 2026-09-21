import { EventEmitter } from "node:events"
import type { Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { ChildStdinWriter } from "./ChildStdinWriter"

function fakeStdin(writeResults: boolean[] = []) {
  const written: string[] = []
  const stream = Object.assign(new EventEmitter(), {
    write: vi.fn((payload: string) => {
      written.push(payload)
      return writeResults.length > 0 ? (writeResults.shift() as boolean) : true
    }),
  })
  return { stream: stream as unknown as Writable, written, emitter: stream }
}

describe("ChildStdinWriter", () => {
  it("survives a stdin error, reports it once, and drops later writes with a log line", () => {
    const { stream, emitter, written } = fakeStdin()
    const logger = { warn: vi.fn() }
    const onError = vi.fn()
    const writer = new ChildStdinWriter(stream, { label: "test rpc", logger, onError })

    expect(writer.write("a\n")).toBe(true)
    expect(() => emitter.emit("error", new Error("EPIPE"))).not.toThrow()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "EPIPE" }))
    expect(writer.isDead).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: "test rpc" }),
      "test rpc stdin errored; later writes are dropped"
    )
    expect(writer.write("b\n")).toBe(false)
    expect(written).toEqual(["a\n"])
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "stdin error: EPIPE", bytes: 2 }),
      "test rpc write dropped; child is gone"
    )
  })

  it("holds writes behind drain when the stream reports backpressure and keeps their order", () => {
    // First write is accepted but the buffer is full (false); the rest queue
    // until `drain`, then flush in order.
    const { stream, emitter, written } = fakeStdin([false, true, true])
    const writer = new ChildStdinWriter(stream, {
      label: "test rpc",
      logger: { warn: vi.fn() },
    })

    expect(writer.write("1\n")).toBe(true)
    expect(writer.write("2\n")).toBe(true)
    expect(writer.write("3\n")).toBe(true)
    expect(written).toEqual(["1\n"])

    emitter.emit("drain")
    expect(written).toEqual(["1\n", "2\n", "3\n"])
  })

  it("reports the queued writes a stdin error drops, not zero", () => {
    const { stream, emitter } = fakeStdin([false])
    const logger = { warn: vi.fn() }
    const writer = new ChildStdinWriter(stream, { label: "test rpc", logger })

    writer.write("1\n")
    writer.write("22\n")
    writer.write("333\n")
    emitter.emit("error", new Error("EPIPE"))

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ dropped: 2, droppedBytes: 7 }),
      "test rpc stdin errored; later writes are dropped"
    )
    expect(writer.pendingBytes).toBe(0)
  })

  it("logs writes still queued when the child exits", () => {
    const { stream } = fakeStdin([false])
    const logger = { warn: vi.fn() }
    const writer = new ChildStdinWriter(stream, { label: "test rpc", logger })

    writer.write("1\n")
    writer.write("22\n")
    writer.markDead("child exited (code=1 signal=null)")

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "child exited (code=1 signal=null)",
        dropped: 1,
        droppedBytes: 3,
      }),
      "test rpc queued writes dropped; child is gone"
    )
  })

  it("refuses a write that would push the drain backlog past its byte bound", () => {
    const { stream, emitter, written } = fakeStdin([false])
    const logger = { warn: vi.fn() }
    const writer = new ChildStdinWriter(stream, {
      label: "test rpc",
      logger,
      queueMaxBytes: 8,
    })

    expect(writer.write("first\n")).toBe(true)
    expect(writer.write("12345678")).toBe(true)
    expect(writer.write("x")).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: 1, queuedBytes: 8, queueMaxBytes: 8 }),
      "test rpc write refused; stdin backlog exceeded its byte bound"
    )
    expect(writer.isDead).toBe(false)

    emitter.emit("drain")
    expect(written).toEqual(["first\n", "12345678"])
    expect(writer.pendingBytes).toBe(0)
    // Bound is on the backlog, not the lifetime: room again after drain.
    expect(writer.write("y")).toBe(true)
  })

  it("keeps order across mixed accepted and back-pressured writes", () => {
    const { stream, emitter, written } = fakeStdin([false, false, true])
    const writer = new ChildStdinWriter(stream, {
      label: "test rpc",
      logger: { warn: vi.fn() },
    })

    expect(writer.write("1\n")).toBe(true) // written, buffer full
    expect(writer.write("2\n")).toBe(true) // queued
    expect(writer.write("3\n")).toBe(true) // queued
    expect(written).toEqual(["1\n"])

    emitter.emit("drain")
    // "2" is written but reports back-pressure again, so "3" waits.
    expect(written).toEqual(["1\n", "2\n"])
    emitter.emit("drain")
    expect(written).toEqual(["1\n", "2\n", "3\n"])
  })

  it("treats a synchronous write throw as the child being gone", () => {
    const logger = { warn: vi.fn() }
    const stream = Object.assign(new EventEmitter(), {
      write: vi.fn(() => {
        throw new Error("write after end")
      }),
    }) as unknown as Writable
    const writer = new ChildStdinWriter(stream, { label: "test rpc", logger })

    expect(writer.write("x\n")).toBe(false)
    expect(writer.isDead).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: "test rpc" }),
      "test rpc stdin write failed; later writes are dropped"
    )
  })
})
