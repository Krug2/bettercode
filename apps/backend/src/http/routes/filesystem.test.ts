import { describe, it, expect } from "vitest";
import { filesystemListSchema, filesystemSearchSchema } from "../validation";

describe("filesystem HTTP body schemas", () => {
  describe("filesystemListSchema", () => {
    it("accepts a path with default showHidden=false", () => {
      const r = filesystemListSchema.safeParse({ path: "/tmp" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.showHidden).toBe(false);
    });

    it("accepts showHidden=true", () => {
      const r = filesystemListSchema.safeParse({ path: "/tmp", showHidden: true });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.showHidden).toBe(true);
    });

    it("rejects non-string path (no toString coercion)", () => {
      expect(
        filesystemListSchema.safeParse({ path: 42 as unknown }).success,
      ).toBe(false);
      expect(
        filesystemListSchema.safeParse({ path: { toString: () => "/tmp" } as unknown }).success,
      ).toBe(false);
    });

    it("rejects empty path", () => {
      expect(filesystemListSchema.safeParse({ path: "" }).success).toBe(false);
    });

    it("rejects oversized path (>2048 chars)", () => {
      const big = "/" + "a".repeat(2500);
      expect(filesystemListSchema.safeParse({ path: big }).success).toBe(false);
    });

    it("rejects non-boolean showHidden", () => {
      expect(
        filesystemListSchema.safeParse({ path: "/tmp", showHidden: "yes" as unknown }).success,
      ).toBe(false);
    });
  });

  describe("filesystemSearchSchema", () => {
    it("accepts root + default query empty + no limit", () => {
      const r = filesystemSearchSchema.safeParse({ root: "/tmp" });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.query).toBe("");
        expect(r.data.limit).toBeUndefined();
      }
    });

    it("accepts an explicit positive integer limit", () => {
      const r = filesystemSearchSchema.safeParse({ root: "/tmp", limit: 200 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.limit).toBe(200);
    });

    it("rejects non-integer limit", () => {
      expect(
        filesystemSearchSchema.safeParse({ root: "/tmp", limit: 1.5 }).success,
      ).toBe(false);
    });

    it("rejects negative or zero limit", () => {
      expect(filesystemSearchSchema.safeParse({ root: "/tmp", limit: 0 }).success).toBe(false);
      expect(filesystemSearchSchema.safeParse({ root: "/tmp", limit: -1 }).success).toBe(false);
    });

    it("rejects limit beyond absolute cap (5000)", () => {
      expect(
        filesystemSearchSchema.safeParse({ root: "/tmp", limit: 100_000 }).success,
      ).toBe(false);
    });

    it("rejects oversized query", () => {
      const big = "x".repeat(257);
      expect(
        filesystemSearchSchema.safeParse({ root: "/tmp", query: big }).success,
      ).toBe(false);
    });

    it("rejects missing root", () => {
      expect(filesystemSearchSchema.safeParse({ query: "x" }).success).toBe(false);
    });
  });
});
