import { describe, it, expect } from "vitest";
import { assertSafeAbsolutePath, PathSafetyError } from "./filesystem-path-safety";

describe("assertSafeAbsolutePath", () => {
  describe("basic validation (both platforms)", () => {
    it("rejects non-string input", () => {
      expect(() => assertSafeAbsolutePath(42 as unknown)).toThrow(PathSafetyError);
      expect(() => assertSafeAbsolutePath(null)).toThrow(PathSafetyError);
      expect(() => assertSafeAbsolutePath(undefined)).toThrow(PathSafetyError);
    });

    it("rejects empty string", () => {
      expect(() => assertSafeAbsolutePath("")).toThrow(/empty/);
    });

    it("rejects NUL byte", () => {
      expect(() => assertSafeAbsolutePath("/tmp/\0evil", "linux")).toThrow(/NUL/);
      expect(() => assertSafeAbsolutePath("C:\\tmp\\\0evil", "win32")).toThrow(/NUL/);
    });

    it("rejects paths > 2048 chars", () => {
      const tooLong = "/" + "a".repeat(2500);
      expect(() => assertSafeAbsolutePath(tooLong, "linux")).toThrow(/exceeds/);
    });

    it("rejects relative paths", () => {
      expect(() => assertSafeAbsolutePath("./foo", "linux")).toThrow(/absolute/);
      expect(() => assertSafeAbsolutePath("foo/bar", "linux")).toThrow(/absolute/);
      expect(() => assertSafeAbsolutePath("..\\foo", "win32")).toThrow(/absolute/);
    });
  });

  describe("POSIX", () => {
    it("accepts normal absolute paths", () => {
      expect(assertSafeAbsolutePath("/home/user", "linux")).toBe("/home/user");
      expect(assertSafeAbsolutePath("/", "linux")).toBe("/");
      expect(assertSafeAbsolutePath("/tmp/foo/bar", "darwin")).toBe("/tmp/foo/bar");
    });

    it("normalizes redundant separators and dots", () => {
      expect(assertSafeAbsolutePath("/home//user/./docs", "linux")).toBe("/home/user/docs");
    });

    it("strips trailing slash (except root)", () => {
      expect(assertSafeAbsolutePath("/home/user/", "linux")).toBe("/home/user");
      expect(assertSafeAbsolutePath("/", "linux")).toBe("/");
    });
  });

  describe("Windows", () => {
    it("accepts drive-letter paths", () => {
      expect(assertSafeAbsolutePath("C:\\Users\\kerim", "win32")).toBe("C:\\Users\\kerim");
      expect(assertSafeAbsolutePath("D:\\", "win32")).toBe("D:\\");
    });

    it("rejects UNC paths", () => {
      expect(() => assertSafeAbsolutePath("\\\\server\\share", "win32")).toThrow(/UNC|device/i);
      expect(() => assertSafeAbsolutePath("//server/share", "win32")).toThrow(/UNC|device/i);
    });

    it("rejects long-path prefix \\\\?\\", () => {
      expect(() => assertSafeAbsolutePath("\\\\?\\C:\\foo", "win32")).toThrow(/UNC|device/i);
    });

    it("rejects DOS device namespace \\\\.\\", () => {
      expect(() => assertSafeAbsolutePath("\\\\.\\PhysicalDrive0", "win32")).toThrow(/UNC|device/i);
    });

    it("rejects reserved device names in any segment", () => {
      expect(() => assertSafeAbsolutePath("C:\\CON", "win32")).toThrow(/reserved/);
      expect(() => assertSafeAbsolutePath("C:\\Users\\PRN", "win32")).toThrow(/reserved/);
      expect(() => assertSafeAbsolutePath("C:\\COM1", "win32")).toThrow(/reserved/);
      expect(() => assertSafeAbsolutePath("C:\\LPT9", "win32")).toThrow(/reserved/);
      expect(() => assertSafeAbsolutePath("C:\\aux.txt", "win32")).toThrow(/reserved/);
    });

    it("is case-insensitive for reserved names", () => {
      expect(() => assertSafeAbsolutePath("C:\\con", "win32")).toThrow(/reserved/);
      expect(() => assertSafeAbsolutePath("C:\\Nul", "win32")).toThrow(/reserved/);
    });

    it("rejects alternate-data-stream colons", () => {
      expect(() => assertSafeAbsolutePath("C:\\foo:bar", "win32")).toThrow(/alternate-data-stream/);
      expect(() => assertSafeAbsolutePath("C:\\Users\\doc:hidden", "win32")).toThrow(
        /alternate-data-stream/
      );
    });

    it("rejects mixed separators", () => {
      expect(() => assertSafeAbsolutePath("C:\\Users/kerim", "win32")).toThrow(/mixed/);
    });

    it("rejects path without drive letter", () => {
      expect(() => assertSafeAbsolutePath("\\Users\\kerim", "win32")).toThrow();
    });
  });
});
