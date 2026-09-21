import {
  httpContracts,
  type HttpContractName,
} from "@betterc0de/schema/http-contracts"
import type { Context } from "hono"
import type { z } from "zod"
import { parseAndHandle, type ParseAndHandleOptions } from "./routeHelpers"

export function handleHttpContract<K extends HttpContractName>(
  c: Context,
  name: K,
  handler: (
    body: z.output<(typeof httpContracts)[K]["request"]>,
    c: Context
  ) => Promise<z.input<(typeof httpContracts)[K]["response"]>>,
  options: ParseAndHandleOptions
): Promise<Response> {
  const contract = httpContracts[name]
  return parseAndHandle(
    c,
    contract.request,
    async (body) => {
      const result = contract.response.parse(
        await handler(body as z.output<(typeof httpContracts)[K]["request"]>, c)
      )
      return result === undefined ? c.body(null, 204) : c.json(result)
    },
    options
  )
}

/** Read models start as persistence data; validate them at the HTTP boundary. */
export function contractJson<K extends HttpContractName>(
  c: Context,
  name: K,
  value: unknown
): Response {
  return c.json(httpContracts[name].response.parse(value))
}
