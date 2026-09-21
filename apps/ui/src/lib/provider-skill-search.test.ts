import { describe, expect, it } from "vitest"
import type { ProviderSkill } from "@betterc0de/schema"
import { searchProviderSkills } from "@/lib/provider-skill-search"

function skill(input: Partial<ProviderSkill> & Pick<ProviderSkill, "name">) {
  return {
    path: `/skills/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ProviderSkill
}

describe("searchProviderSkills", () => {
  const skills = [
    skill({
      name: "z-review",
      displayName: "Review",
      shortDescription: "Audit code changes",
      description: "Inspect patches for regressions",
      scope: "project",
    }),
    skill({
      name: "review-helper",
      displayName: "Code helper",
      shortDescription: "Prepare implementation notes",
      scope: "user",
    }),
    skill({
      name: "gh-fix-ci",
      displayName: "Fix CI",
      shortDescription: "Inspect GitHub Actions failures",
      scope: "plugin",
    }),
    skill({
      name: "disabled-review",
      displayName: "Disabled Review",
      enabled: false,
    }),
  ]

  it("ranks display names before name prefixes", () => {
    expect(
      searchProviderSkills(skills, "$review").map((item) => item.name)
    ).toEqual(["z-review", "review-helper"])
  })

  it("fuzzy matches names and searches short descriptions, descriptions, and scope", () => {
    expect(
      searchProviderSkills(skills, "gfc").map((item) => item.name)
    ).toEqual(["gh-fix-ci"])
    expect(
      searchProviderSkills(skills, "actions").map((item) => item.name)
    ).toEqual(["gh-fix-ci"])
    expect(
      searchProviderSkills(skills, "patches").map((item) => item.name)
    ).toEqual(["z-review"])
    expect(
      searchProviderSkills(skills, "plugin").map((item) => item.name)
    ).toEqual(["gh-fix-ci"])
  })

  it("omits disabled skills and honors limits", () => {
    expect(
      searchProviderSkills(skills, "", 2).map((item) => item.name)
    ).toEqual(["z-review", "review-helper"])
    expect(searchProviderSkills(skills, "disabled")).toEqual([])
  })
})
