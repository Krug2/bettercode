import { describe, expect, it } from "vitest";
import {
  checkpointRefForThreadTurn,
  parseTurnDiffFilesFromUnifiedDiff,
} from "@betterc0de/schema";

describe("parseTurnDiffFilesFromUnifiedDiff", () => {
  it.each([
    ".tmp-shots/profile/Default/Local Storage/leveldb/LOCK",
    ".tmp-shots/profile/Default/Shared Dictionary/cache/index",
    "assets/my b/folder/image with spaces.png",
    "src/file with spaces.ts",
  ])("preserves unquoted paths with spaces without a +++ header: %s", (filePath) => {
    const diff = `diff --git a/${filePath} b/${filePath}\nBinary files a/${filePath} and b/${filePath} differ\n`;
    expect(parseTurnDiffFilesFromUnifiedDiff(diff)).toEqual([{ path: filePath, additions: 0, deletions: 0 }]);
  });

  it("preserves deleted paths containing spaces", () => {
    const diff = "diff --git a/src/old file.ts b/src/old file.ts\n--- a/src/old file.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
    expect(parseTurnDiffFilesFromUnifiedDiff(diff)).toEqual([{ path: "src/old file.ts", additions: 0, deletions: 1 }]);
  });

  it("returns empty list for empty diffs", () => {
    expect(parseTurnDiffFilesFromUnifiedDiff("")).toEqual([]);
    expect(parseTurnDiffFilesFromUnifiedDiff("\r\n  \n")).toEqual([]);
  });

  it("parses per-file additions and deletions", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "index 1111111..2222222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,3 @@",
      " one",
      "-two",
      "+two updated",
      "+three",
      "diff --git a/src/b.ts b/src/b.ts",
      "index 3333333..4444444 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -3,2 +3,0 @@",
      "-old",
      "-stale",
      "",
    ].join("\n");

    expect(parseTurnDiffFilesFromUnifiedDiff(diff)).toEqual([
      { path: "a.txt", additions: 2, deletions: 1 },
      { path: "src/b.ts", additions: 0, deletions: 2 },
    ]);
  });

  it("parses rename-only diffs with zero line changes", () => {
    const diff = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "",
    ].join("\n");

    expect(parseTurnDiffFilesFromUnifiedDiff(diff)).toEqual([
      { path: "src/new.ts", additions: 0, deletions: 0 },
    ]);
  });

  it("normalizes CRLF input before parsing", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "index 1111111..2222222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1,2 @@",
      "-one",
      "+one updated",
      "+two",
      "",
    ].join("\r\n");

    expect(parseTurnDiffFilesFromUnifiedDiff(diff)).toEqual([
      { path: "a.txt", additions: 2, deletions: 1 },
    ]);
  });
});

describe("checkpointRefForThreadTurn", () => {
  it("uses a stable base64url thread namespace", () => {
    expect(checkpointRefForThreadTurn("thread-1", 2)).toBe(
      "refs/betterc0de/checkpoints/dGhyZWFkLTE/turn/2",
    );
  });

  it("rejects invalid turn counts", () => {
    expect(() => checkpointRefForThreadTurn("thread-1", -1)).toThrow(/turnCount/);
    expect(() => checkpointRefForThreadTurn("thread-1", 1.5)).toThrow(/turnCount/);
  });
});
