import { ZodError, type z } from "zod";
import { sanitizeError } from "./errors";

// Hono's typed Context is verbose and inference breaks when fed into an
// explicit helper signature. The helper relies only on `c.req.json`,
// `c.req.path`, `c.json`, and `c.body`, so a loose alias keeps signatures
// readable across all the routes that adopt it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoCtx = any;

export interface ParseAndHandleOptions {
  /** Operation label, used by `sanitizeError` when the handler throws. */
  operation: string;
}

/**
 * Backend HTTP route helper. Parses the JSON body, validates it with `schema`,
 * runs `handler`, and normalizes errors to a uniform shape so the renderer
 * never has to guess whether to call `response.text()` or `response.json()`.
 *
 *  - Body not JSON     → 400 `{error: "invalid json"}`
 *  - Schema fails      → 400 `{error: <zod message>}`
 *  - Handler throws a nominal `HttpError` → propagated verbatim
 *  - Handler throws a duck-typed `{statusCode, message}` error → status/code
 *    preserved, internal message masked
 *  - Handler throws anything else → safe metadata logged via pino, client gets
 *                                   500 `{error: "<operation> failed"}`
 *
 * The handler may return either a value (auto-serialized via `c.json`) or a
 * `Response` directly (for 204, custom headers, streaming bodies).
 */
export async function parseAndHandle<S extends z.ZodType>(
  c: HonoCtx,
  schema: S,
  handler: (body: z.infer<S>, c: HonoCtx) => Promise<unknown>,
  opts: ParseAndHandleOptions,
): Promise<Response> {
  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  let parsed: z.infer<S>;
  try {
    const result = schema.safeParse(raw);
    if (!result.success) {
      return c.json({ error: result.error.message }, 400);
    }
    parsed = result.data;
  } catch (err) {
    // Some shared schemas normalize camelCase/snake_case fields inside a
    // transform using nested `.parse()` calls. Zod propagates those nested
    // validation errors instead of wrapping them in safeParse's result.
    if (err instanceof ZodError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
  try {
    const out = await handler(parsed, c);
    if (out instanceof Response) return out;
    return c.json(out);
  } catch (err) {
    const { message, statusCode, code } = sanitizeError(err, opts.operation, {
      path: c.req.path,
    });
    const body = code !== undefined ? { error: message, code } : { error: message };
    return c.json(body, statusCode as 400 | 401 | 403 | 404 | 500);
  }
}
