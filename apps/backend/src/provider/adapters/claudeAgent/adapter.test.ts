import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeAgentAdapter } from "./adapter";
import type { ProviderSendTurnInput } from "../../types";

const mocks = vi.hoisted(() => ({ load: vi.fn(), query: vi.fn(), tools: vi.fn(), permissions: vi.fn() }));
vi.mock("./session-manager", () => ({ loadClaudeSdk: mocks.load }));
vi.mock("../../../services/workspace", () => ({ listProjectTools: mocks.tools, listProjectPermissions: mocks.permissions }));

const input = { thread_id: "legacy-claude", project_path: process.cwd(), message: "hello", model_id: "claude-opus-4-7", history: [] } as ProviderSendTurnInput;

describe("legacy Claude startup boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue({ query: mocks.query });
    mocks.tools.mockResolvedValue([]);
    mocks.permissions.mockResolvedValue([]);
    mocks.query.mockReturnValue({ async *[Symbol.asyncIterator]() {}, close: vi.fn() });
  });

  it("fails closed when project permission rules cannot be read", async () => {
    const failure = new Error("project policy unreadable");
    mocks.permissions.mockRejectedValue(failure);
    await expect(new ClaudeAgentAdapter().sendMessage(input)).rejects.toBe(failure);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["sdk", "policy"])("cancels before query creation while waiting for %s", async (stage) => {
    let release!: () => void;
    const adapter = new ClaudeAgentAdapter();
    if (stage === "sdk") mocks.load.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ query: mocks.query }); }));
    else mocks.permissions.mockImplementation(() => new Promise((resolve) => { release = () => resolve([]); }));
    const sending = adapter.sendMessage(input);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await adapter.interrupt(input.thread_id);
    release();
    await sending;
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.load.mockResolvedValue({ query: mocks.query });
    mocks.permissions.mockResolvedValue([]);
    await adapter.sendMessage(input);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
});
