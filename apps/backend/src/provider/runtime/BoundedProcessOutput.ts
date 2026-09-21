export const DEFAULT_PROVIDER_PROBE_OUTPUT_BYTE_CAP = 256 * 1024

export interface BoundedProcessOutput {
  stdout: string
  stderr: string
  readonly byteCap: number
  bufferedBytes: number
  limitExceeded: boolean
}

export function createBoundedProcessOutput(
  byteCap = DEFAULT_PROVIDER_PROBE_OUTPUT_BYTE_CAP
): BoundedProcessOutput {
  if (!Number.isSafeInteger(byteCap) || byteCap < 1) {
    throw new RangeError("process output byte cap must be a positive integer")
  }
  return {
    stdout: "",
    stderr: "",
    byteCap,
    bufferedBytes: 0,
    limitExceeded: false,
  }
}

/**
 * Retains at most `byteCap` bytes across stdout and stderr. False means the
 * current chunk crossed the combined cap and the owning process must be
 * terminated before the probe settles.
 */
export function appendBoundedProcessOutput(
  output: BoundedProcessOutput,
  stream: "stdout" | "stderr",
  chunk: Buffer | string
): boolean {
  if (output.limitExceeded) return false
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")
  const remaining = output.byteCap - output.bufferedBytes
  const retainedLength = Math.min(Math.max(0, remaining), bytes.length)
  if (retainedLength > 0) {
    output[stream] += bytes.subarray(0, retainedLength).toString("utf8")
    output.bufferedBytes += retainedLength
  }
  if (bytes.length <= remaining) return true
  output.limitExceeded = true
  return false
}

export function processOutputLimitError(
  label: string,
  byteCap: number
): Error {
  return Object.assign(
    new Error(`${label} exceeded the combined ${byteCap}-byte output limit.`),
    {
      code: "PROVIDER_PROBE_OUTPUT_LIMIT_EXCEEDED",
      byteCap,
    }
  )
}
