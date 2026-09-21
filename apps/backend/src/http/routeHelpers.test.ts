import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { parseAndHandle } from "./routeHelpers";
import { httpError } from "./errors";

// Minimal Hono context stub. parseAndHandle relies only on `c.req.json`,
// `c.req.path`, `c.json`, and `c.body` — replicate just those.
function buildCtx(rawBody: unknown | (() => Promise<unknown>), path = "/test"): {
  c: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
} {
  const json = vi.fn(
    (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  const body = vi.fn(
    (data: unknown, status = 200) => new Response(data as never, { status }),
  );
  const reqJson = typeof rawBody === "function" ? rawBody : () => Promise.resolve(rawBody);
  return {
    c: { req: { json: reqJson, path }, json, body },
    json,
    body,
  };
}

const sampleSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative().default(0),
});

describe("parseAndHandle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when the body is not JSON", async () => {
    const { c, json } = buildCtx(() => Promise.reject(new Error("bad json")));
    const handler = vi.fn();
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    expect(json).toHaveBeenCalledWith({ error: "invalid json" }, 400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 with zod message when validation fails", async () => {
    const { c, json } = buildCtx({ name: "" });
    const handler = vi.fn();
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    expect(json).toHaveBeenCalledTimes(1);
    const args = json.mock.calls[0];
    expect(args[1]).toBe(400);
    expect(args[0]).toMatchObject({ error: expect.any(String) });
    expect(handler).not.toHaveBeenCalled();
  });

  it("forwards parsed body to the handler and serializes the return value", async () => {
    const { c, json } = buildCtx({ name: "alice" });
    const handler = vi.fn().mockResolvedValue({ greet: "hello alice" });
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    expect(handler).toHaveBeenCalledWith({ name: "alice", count: 0 }, expect.anything());
    expect(json).toHaveBeenCalledWith({ greet: "hello alice" });
  });

  it("passes through a Response returned by the handler unchanged", async () => {
    const { c, json } = buildCtx({ name: "alice" });
    const sentinel = new Response(null, { status: 204 });
    const handler = vi.fn().mockResolvedValue(sentinel);
    const out = await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    expect(out).toBe(sentinel);
    expect(json).not.toHaveBeenCalled();
  });

  it("propagates HttpError-shaped failures verbatim", async () => {
    const { c, json } = buildCtx({ name: "alice" });
    const handler = vi.fn().mockRejectedValue(httpError(403, "nope"));
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    expect(json).toHaveBeenCalledWith({ error: "nope" }, 403);
  });

  it("preserves status/code but masks duck-typed service error messages", async () => {
    const { c, json } = buildCtx({ name: "alice" });
    const handler = vi.fn().mockRejectedValue(
      Object.assign(new Error("not found"), { statusCode: 404, code: "ENOENT" }),
    );
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    expect(json).toHaveBeenCalledWith({ error: "op failed", code: "ENOENT" }, 404);
  });

  it("masks unknown failures with a generic 500 and operation label", async () => {
    const { c, json } = buildCtx({ name: "alice" });
    const handler = vi.fn().mockRejectedValue(new Error("very internal detail"));
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "thing" });
    expect(json).toHaveBeenCalledWith({ error: "thing failed" }, 500);
  });

  it("passes the Hono context as the second handler argument", async () => {
    const { c } = buildCtx({ name: "alice" }, "/some/path");
    const handler = vi.fn().mockResolvedValue({});
    await parseAndHandle(c as never, sampleSchema, handler, { operation: "op" });
    const ctxArg = handler.mock.calls[0]?.[1] as { req: { path: string } };
    expect(ctxArg.req.path).toBe("/some/path");
  });
});
