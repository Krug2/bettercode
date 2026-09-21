import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AuthStore, type Credential } from "./store";
import { __resetMasterKeyCache } from "../settings/crypto";

function tmpAuthPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bc0de-auth-${label}-`));
  return path.join(dir, "auth.json");
}

beforeEach(() => {
  // Provision a deterministic master key so encryption is exercised.
  process.env.BETTERC0DE_SETTINGS_KEY = crypto.randomBytes(32).toString("base64");
  __resetMasterKeyCache();
});

afterEach(() => {
  delete process.env.BETTERC0DE_SETTINGS_KEY;
  __resetMasterKeyCache();
});

describe("AuthStore", () => {
  it("stores and retrieves an OAuth credential round-trip", () => {
    const store = new AuthStore(tmpAuthPath("oauth"));
    const cred: Credential = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 3600_000,
      accountId: "acc-123",
    };
    store.set("openai", cred);
    expect(store.get("openai")).toEqual(cred);
  });

  it("encrypts blobs at rest — raw file contains the enc:v1: prefix", () => {
    const p = tmpAuthPath("encrypted");
    const store = new AuthStore(p);
    store.set("openai", {
      type: "oauth",
      access: "secret-access",
      refresh: "secret-refresh",
      expires: Date.now() + 60_000,
    });
    const onDisk = fs.readFileSync(p, "utf8");
    expect(onDisk).toContain("enc:v1:");
    expect(onDisk).not.toContain("secret-access");
    expect(onDisk).not.toContain("secret-refresh");
  });

  it("returns undefined for a missing provider and false for has()", () => {
    const store = new AuthStore(tmpAuthPath("missing"));
    expect(store.get("openai")).toBeUndefined();
    expect(store.has("openai")).toBe(false);
  });

  it("removes a credential and leaves the rest", () => {
    const store = new AuthStore(tmpAuthPath("remove"));
    const cred: Credential = { type: "api", key: "sk-test" };
    store.set("openai", cred);
    store.set("anthropic", { type: "api", key: "sk-ant-test" });
    store.remove("openai");
    expect(store.get("openai")).toBeUndefined();
    expect(store.get("anthropic")).toBeDefined();
  });

  it("all() returns every stored credential decrypted", () => {
    const store = new AuthStore(tmpAuthPath("all"));
    store.set("openai", { type: "api", key: "sk-1" });
    store.set("anthropic", { type: "api", key: "sk-2" });
    const all = store.all();
    expect(Object.keys(all).sort()).toEqual(["anthropic", "openai"]);
    expect((all["openai"] as { key: string }).key).toBe("sk-1");
  });

  it("survives malformed entries — drops them, keeps valid ones", () => {
    const p = tmpAuthPath("malformed");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      good: '{"type":"api","key":"plain"}', // legacy plaintext, valid
      bad_blob: "not-encrypted-not-json",
      bad_shape: '{"type":"unknown"}',
    }), { encoding: "utf8" });
    const store = new AuthStore(p);
    expect(store.get("good")?.type).toBe("api");
    expect(store.get("bad_blob")).toBeUndefined();
    expect(store.get("bad_shape")).toBeUndefined();
  });

  it("treats a missing auth.json as empty (no throw on first read)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-auth-noent-"));
    const store = new AuthStore(path.join(dir, "auth.json"));
    expect(store.all()).toEqual({});
    expect(store.has("anything")).toBe(false);
  });

  it.each(["set", "remove"] as const)(
    "migrates every surviving plaintext credential when %s writes the store",
    (operation) => {
      const p = tmpAuthPath(`legacy-${operation}`);
      const retained: Credential = {
        type: "oauth",
        access: "legacy-access-secret",
        refresh: "legacy-refresh-secret",
        expires: Date.now() + 60_000,
      };
      fs.writeFileSync(p, JSON.stringify({
        anthropic: JSON.stringify(retained),
        openai: JSON.stringify({ type: "api", key: "previous-key" }),
      }), "utf8");
      const store = new AuthStore(p);

      if (operation === "set") store.set("openai", { type: "api", key: "new-key" });
      else store.remove("openai");

      const onDisk = fs.readFileSync(p, "utf8");
      expect(onDisk).not.toContain("legacy-access-secret");
      expect(onDisk).not.toContain("legacy-refresh-secret");
      expect(Object.values(JSON.parse(onDisk)).every(
        (blob) => typeof blob === "string" && blob.startsWith("enc:v1:")
      )).toBe(true);
      expect(store.get("anthropic")).toEqual(retained);
      expect(store.get("openai")).toEqual(
        operation === "set" ? { type: "api", key: "new-key" } : undefined
      );
    }
  );

  it("refuses to persist credentials when encryption is unavailable", () => {
    const p = tmpAuthPath("no-key");
    delete process.env.BETTERC0DE_SETTINGS_KEY;
    __resetMasterKeyCache();

    const store = new AuthStore(p);
    expect(() => store.set("openai", { type: "api", key: "must-not-leak" }))
      .toThrow("encryption key is unavailable");
    expect(fs.existsSync(p)).toBe(false);
  });

  it("fails closed on existing credentials when encryption is unavailable", () => {
    const p = tmpAuthPath("locked-read");
    const store = new AuthStore(p);
    store.set("openai", { type: "api", key: "encrypted-secret" });

    delete process.env.BETTERC0DE_SETTINGS_KEY;
    __resetMasterKeyCache();

    expect(() => store.get("openai")).toThrow("encryption key is unavailable");
    expect(() => store.all()).toThrow("encryption key is unavailable");
    expect(() => store.has("openai")).toThrow("encryption key is unavailable");
    expect(() => store.remove("openai")).toThrow("encryption key is unavailable");
    expect(fs.readFileSync(p, "utf8")).not.toContain("encrypted-secret");
  });

  it("rejects malformed credentials before they can poison the store", () => {
    const p = tmpAuthPath("invalid-shape");
    const store = new AuthStore(p);

    expect(() =>
      store.set("openai", { type: "oauth" } as unknown as Credential)
    ).toThrow("invalid credential");
    expect(() =>
      store.set("anthropic", { type: "api", key: "" } as Credential)
    ).toThrow("invalid credential");
    expect(fs.existsSync(p)).toBe(false);
  });

  it("bounds credential string sizes before they reach disk", () => {
    const p = tmpAuthPath("bounded");
    const store = new AuthStore(p);

    expect(() =>
      store.set("openai", { type: "api", key: "k".repeat(16 * 1024 + 1) })
    ).toThrow("invalid credential");
    expect(() =>
      store.set("openai", {
        type: "api",
        key: "ok",
        metadata: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`k${index}`, "v"])
        ),
      })
    ).toThrow("invalid credential");
    expect(() =>
      store.set("openai", {
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: 1,
        accountId: "x".repeat(1_025),
      })
    ).toThrow("invalid credential");
    expect(fs.existsSync(p)).toBe(false);

    store.set("openai", { type: "api", key: "k".repeat(16 * 1024) });
    expect(store.get("openai")).toMatchObject({ type: "api" });
  });

  it("never loses one of two writes issued in the same tick", async () => {
    // `set` is a synchronous read-modify-write with no await inside, so two
    // callers cannot interleave; this pins that property so a future async
    // rewrite has to bring its own serialisation.
    const p = tmpAuthPath("concurrent");
    const store = new AuthStore(p);

    await Promise.all([
      Promise.resolve().then(() =>
        store.set("openai", { type: "api", key: "first" })
      ),
      Promise.resolve().then(() =>
        store.set("anthropic", { type: "api", key: "second" })
      ),
    ]);

    expect(store.all()).toEqual({
      openai: { type: "api", key: "first" },
      anthropic: { type: "api", key: "second" },
    });
  });

  it("preserves a corrupt auth file and blocks mutations", () => {
    const p = tmpAuthPath("corrupt");
    const original = "{ definitely-not-json";
    fs.writeFileSync(p, original, "utf8");
    const store = new AuthStore(p);

    expect(() => store.set("openai", { type: "api", key: "new-key" }))
      .toThrow("auth.json is corrupt or unreadable");
    expect(() => store.remove("openai"))
      .toThrow("auth.json is corrupt or unreadable");
    expect(fs.readFileSync(p, "utf8")).toBe(original);
  });
});
