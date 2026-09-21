import { describe, it, expect } from "vitest"
import {
  workspaceReadSchema,
  workspaceWriteSchema,
  workspaceSearchSchema,
  workspaceContentSearchSchema,
  workspaceQuickOpenSchema,
  workspaceMapSchema,
  workspaceProjectAgentsSchema,
  workspaceProjectCommandsSchema,
  workspaceProjectInstructionsSchema,
  workspaceProjectMcpServersSchema,
  workspaceProjectReferencesSchema,
  workspaceProjectFormattersSchema,
  workspaceProjectFormatSchema,
  workspaceProjectLspServersSchema,
  workspaceProjectPermissionsSchema,
  workspaceProjectConfigSchema,
  workspaceProjectProvidersSchema,
  workspaceProjectPluginsSchema,
  workspaceProjectToolsSchema,
  workspaceProjectSkillsSchema,
  workspaceMkdirSchema,
  workspaceMoveSchema,
  workspaceDeleteSchema,
} from "../validation"

describe("workspace HTTP body schemas", () => {
  describe("workspaceReadSchema", () => {
    it("accepts a well-formed body", () => {
      const r = workspaceReadSchema.safeParse({
        cwd: ".",
        relativePath: "src/main.ts",
      })
      expect(r.success).toBe(true)
    })

    it("rejects missing cwd", () => {
      expect(workspaceReadSchema.safeParse({ relativePath: "x" }).success).toBe(
        false
      )
    })

    it("rejects missing relativePath", () => {
      expect(workspaceReadSchema.safeParse({ cwd: "." }).success).toBe(false)
    })

    it("rejects empty cwd / relativePath", () => {
      expect(
        workspaceReadSchema.safeParse({ cwd: "", relativePath: "x" }).success
      ).toBe(false)
      expect(
        workspaceReadSchema.safeParse({ cwd: ".", relativePath: "" }).success
      ).toBe(false)
    })

    it("rejects non-string relativePath (no toString coercion)", () => {
      expect(
        workspaceReadSchema.safeParse({
          cwd: ".",
          relativePath: { toString: "evil" } as unknown,
        }).success
      ).toBe(false)
      expect(
        workspaceReadSchema.safeParse({ cwd: ".", relativePath: 42 as unknown })
          .success
      ).toBe(false)
      expect(
        workspaceReadSchema.safeParse({
          cwd: ".",
          relativePath: null as unknown,
        }).success
      ).toBe(false)
    })

    it("rejects oversized path (>2048 chars)", () => {
      const big = "a/".repeat(1100)
      expect(
        workspaceReadSchema.safeParse({ cwd: ".", relativePath: big }).success
      ).toBe(false)
    })

    it("does not reject path-traversal at the schema layer (service layer enforces containment)", () => {
      // Schema only does shape + size validation. The service layer's
      // safeResolveInside is the canonical traversal guard.
      const r = workspaceReadSchema.safeParse({
        cwd: ".",
        relativePath: "../../etc/passwd",
      })
      expect(r.success).toBe(true)
    })
  })

  describe("workspaceWriteSchema", () => {
    it("accepts a well-formed body", () => {
      const r = workspaceWriteSchema.safeParse({
        cwd: ".",
        relativePath: "src/main.ts",
        contents: "console.log('hi')",
      })
      expect(r.success).toBe(true)
    })

    it("requires contents to be a string", () => {
      expect(
        workspaceWriteSchema.safeParse({
          cwd: ".",
          relativePath: "x",
          contents: { toString: () => "evil" } as unknown,
        }).success
      ).toBe(false)
      expect(
        workspaceWriteSchema.safeParse({
          cwd: ".",
          relativePath: "x",
          contents: 42 as unknown,
        }).success
      ).toBe(false)
    })

    it("rejects oversized writes (>50MB)", () => {
      const big = "x".repeat(50 * 1024 * 1024 + 1)
      expect(
        workspaceWriteSchema.safeParse({
          cwd: ".",
          relativePath: "big.txt",
          contents: big,
        }).success
      ).toBe(false)
    })

    it("rejects missing fields", () => {
      expect(workspaceWriteSchema.safeParse({}).success).toBe(false)
      expect(workspaceWriteSchema.safeParse({ cwd: "." }).success).toBe(false)
      expect(
        workspaceWriteSchema.safeParse({ cwd: ".", relativePath: "x" }).success
      ).toBe(false)
    })
  })

  describe("workspaceSearchSchema", () => {
    it("defaults query to empty string", () => {
      const r = workspaceSearchSchema.safeParse({ cwd: "." })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.query).toBe("")
    })

    it("rejects oversized queries", () => {
      const big = "x".repeat(257)
      expect(
        workspaceSearchSchema.safeParse({ cwd: ".", query: big }).success
      ).toBe(false)
    })

    it("rejects missing cwd", () => {
      expect(workspaceSearchSchema.safeParse({ query: "x" }).success).toBe(
        false
      )
    })
  })

  describe("workspaceContentSearchSchema", () => {
    it("accepts a well-formed body and defaults limit", () => {
      const r = workspaceContentSearchSchema.safeParse({
        cwd: ".",
        query: "needle",
      })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.limit).toBe(200)
        expect(r.data.caseSensitive).toBe(false)
        expect(r.data.wholeWord).toBe(false)
        expect(r.data.regex).toBe(false)
        expect(r.data.include).toBe("")
        expect(r.data.exclude).toBe("")
      }
    })

    it("accepts search mode options", () => {
      const r = workspaceContentSearchSchema.safeParse({
        cwd: ".",
        query: "needle",
        caseSensitive: true,
        wholeWord: true,
        regex: true,
        include: "src/**/*.ts",
        exclude: "*.test.ts",
      })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.caseSensitive).toBe(true)
        expect(r.data.wholeWord).toBe(true)
        expect(r.data.regex).toBe(true)
        expect(r.data.include).toBe("src/**/*.ts")
        expect(r.data.exclude).toBe("*.test.ts")
      }
    })

    it("rejects blank and oversized queries", () => {
      expect(
        workspaceContentSearchSchema.safeParse({ cwd: ".", query: "   " })
          .success
      ).toBe(false)
      const big = "x".repeat(257)
      expect(
        workspaceContentSearchSchema.safeParse({ cwd: ".", query: big }).success
      ).toBe(false)
    })

    it("bounds result limits", () => {
      expect(
        workspaceContentSearchSchema.safeParse({
          cwd: ".",
          query: "needle",
          limit: 0,
        }).success
      ).toBe(false)
      expect(
        workspaceContentSearchSchema.safeParse({
          cwd: ".",
          query: "needle",
          limit: 501,
        }).success
      ).toBe(false)
    })
  })

  describe("workspaceQuickOpenSchema", () => {
    it("defaults query and limit", () => {
      const r = workspaceQuickOpenSchema.safeParse({ cwd: "." })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.query).toBe("")
        expect(r.data.limit).toBe(80)
        expect(r.data.include).toBe("")
      }
    })

    it("bounds queries and result limits", () => {
      expect(
        workspaceQuickOpenSchema.safeParse({
          cwd: ".",
          query: "x".repeat(257),
        }).success
      ).toBe(false)
      expect(
        workspaceQuickOpenSchema.safeParse({ cwd: ".", limit: 0 }).success
      ).toBe(false)
      expect(
        workspaceQuickOpenSchema.safeParse({ cwd: ".", limit: 201 }).success
      ).toBe(false)
    })
  })

  describe("workspaceMapSchema", () => {
    it("defaults maxFiles", () => {
      const r = workspaceMapSchema.safeParse({ cwd: "." })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.maxFiles).toBe(5000)
      }
    })

    it("bounds maxFiles", () => {
      expect(
        workspaceMapSchema.safeParse({ cwd: ".", maxFiles: 99 }).success
      ).toBe(false)
      expect(
        workspaceMapSchema.safeParse({ cwd: ".", maxFiles: 20001 }).success
      ).toBe(false)
    })
  })

  describe("workspaceProjectCommandsSchema", () => {
    it("accepts a workspace cwd", () => {
      expect(
        workspaceProjectCommandsSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
    })

    it("rejects missing cwd", () => {
      expect(workspaceProjectCommandsSchema.safeParse({}).success).toBe(false)
    })
  })

  describe("workspaceProjectAgentsSchema", () => {
    it("accepts a workspace cwd", () => {
      expect(workspaceProjectAgentsSchema.safeParse({ cwd: "." }).success).toBe(
        true
      )
    })

    it("rejects missing cwd", () => {
      expect(workspaceProjectAgentsSchema.safeParse({}).success).toBe(false)
    })
  })

  describe("workspaceProjectSkillsSchema", () => {
    it("accepts a workspace cwd", () => {
      expect(workspaceProjectSkillsSchema.safeParse({ cwd: "." }).success).toBe(
        true
      )
    })

    it("rejects missing cwd", () => {
      expect(workspaceProjectSkillsSchema.safeParse({}).success).toBe(false)
    })
  })

  describe("workspaceProjectMcpServersSchema", () => {
    it("accepts a workspace cwd", () => {
      expect(
        workspaceProjectMcpServersSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
    })

    it("rejects missing cwd", () => {
      expect(workspaceProjectMcpServersSchema.safeParse({}).success).toBe(false)
    })
  })

  describe("workspaceProjectInstructionsSchema", () => {
    it("accepts a workspace cwd", () => {
      expect(
        workspaceProjectInstructionsSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
    })

    it("rejects missing cwd", () => {
      expect(workspaceProjectInstructionsSchema.safeParse({}).success).toBe(
        false
      )
    })
  })

  describe("workspaceProjectReferencesSchema", () => {
    it("accepts a workspace cwd", () => {
      expect(
        workspaceProjectReferencesSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
    })

    it("rejects missing cwd", () => {
      expect(workspaceProjectReferencesSchema.safeParse({}).success).toBe(false)
    })
  })

  describe("BetterC0de project config schemas", () => {
    it("accepts a workspace cwd for formatters, LSP servers, and permissions", () => {
      expect(
        workspaceProjectFormattersSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
      expect(
        workspaceProjectFormatSchema.safeParse({
          cwd: ".",
          relativePath: "src/main.ts",
          formatterId: "prettier",
        }).success
      ).toBe(true)
      expect(
        workspaceProjectLspServersSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
      expect(
        workspaceProjectPermissionsSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
      expect(workspaceProjectConfigSchema.safeParse({ cwd: "." }).success).toBe(
        true
      )
      expect(
        workspaceProjectProvidersSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
      expect(
        workspaceProjectPluginsSchema.safeParse({ cwd: "." }).success
      ).toBe(true)
      expect(workspaceProjectToolsSchema.safeParse({ cwd: "." }).success).toBe(
        true
      )
    })

    it("rejects missing cwd for formatters, LSP servers, and permissions", () => {
      expect(workspaceProjectFormattersSchema.safeParse({}).success).toBe(false)
      expect(
        workspaceProjectFormatSchema.safeParse({ relativePath: "src/main.ts" })
          .success
      ).toBe(false)
      expect(workspaceProjectFormatSchema.safeParse({ cwd: "." }).success).toBe(
        false
      )
      expect(workspaceProjectLspServersSchema.safeParse({}).success).toBe(false)
      expect(workspaceProjectPermissionsSchema.safeParse({}).success).toBe(
        false
      )
      expect(workspaceProjectConfigSchema.safeParse({}).success).toBe(false)
      expect(workspaceProjectProvidersSchema.safeParse({}).success).toBe(false)
      expect(workspaceProjectPluginsSchema.safeParse({}).success).toBe(false)
      expect(workspaceProjectToolsSchema.safeParse({}).success).toBe(false)
    })
  })

  describe("workspace file operation schemas", () => {
    it("accepts mkdir, move, and delete bodies", () => {
      expect(
        workspaceMkdirSchema.safeParse({
          cwd: ".",
          relativePath: "src/components",
        }).success
      ).toBe(true)
      expect(
        workspaceMoveSchema.safeParse({
          cwd: ".",
          fromRelativePath: "src/old.ts",
          toRelativePath: "src/new.ts",
        }).success
      ).toBe(true)
      const del = workspaceDeleteSchema.safeParse({
        cwd: ".",
        relativePath: "src",
      })
      expect(del.success).toBe(true)
      if (del.success) expect(del.data.recursive).toBe(false)
    })

    it("rejects missing file operation paths", () => {
      expect(workspaceMkdirSchema.safeParse({ cwd: "." }).success).toBe(false)
      expect(
        workspaceMoveSchema.safeParse({
          cwd: ".",
          fromRelativePath: "src/old.ts",
        }).success
      ).toBe(false)
      expect(workspaceDeleteSchema.safeParse({ cwd: "." }).success).toBe(false)
    })
  })
})
