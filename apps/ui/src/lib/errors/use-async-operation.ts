import { useCallback, useRef, useState } from "react"
import { AppError } from "./types"
import { handleError } from "./handle"

export interface UseAsyncOperationOptions {
  source: string
  silent?: boolean
  onSuccess?: () => void
  onError?: (err: AppError) => void
}

export interface UseAsyncOperationResult<Args extends unknown[], Result> {
  run: (...args: Args) => Promise<Result | undefined>
  data: Result | undefined
  error: AppError | null
  isLoading: boolean
  reset: () => void
}

/**
 * Wraps an async operation so components don't repeat the try/catch →
 * toast dance. Returns a stable `run` callback plus derived UI state.
 *
 * Call sites migrate from:
 *     try { await submit() } catch (e) { toast(String(e)) }
 * to:
 *     const { run } = useAsyncOperation(submit, { source: "chat-submit" })
 *     run()
 */
export function useAsyncOperation<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  options: UseAsyncOperationOptions,
): UseAsyncOperationResult<Args, Result> {
  const [data, setData] = useState<Result | undefined>(undefined)
  const [error, setError] = useState<AppError | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const run = useCallback(
    async (...args: Args) => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await fn(...args)
        setData(result)
        optionsRef.current.onSuccess?.()
        return result
      } catch (err) {
        const appErr = handleError(err, {
          source: optionsRef.current.source,
          silent: optionsRef.current.silent,
        })
        setError(appErr)
        optionsRef.current.onError?.(appErr)
        return undefined
      } finally {
        setIsLoading(false)
      }
    },
    [fn],
  )

  const reset = useCallback(() => {
    setData(undefined)
    setError(null)
    setIsLoading(false)
  }, [])

  return { run, data, error, isLoading, reset }
}
