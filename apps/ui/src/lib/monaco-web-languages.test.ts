import { describe, expect, it, vi } from "vitest"
import { registerWebLanguageAliases } from "./monaco-web-languages"

describe("embedded HTML language aliases", () => {
  it("adds JSON-LD and import-map aliases without replacing existing JSON support or registering twice", () => {
    const registrations = [{ id: "json", mimetypes: ["application/json"] }]
    const monaco = { languages: {
      getLanguages: () => registrations,
      register: vi.fn((language) => registrations.push(language)),
      onLanguageEncountered: vi.fn(),
    } }
    const instance = monaco as unknown as Parameters<typeof registerWebLanguageAliases>[0]
    registerWebLanguageAliases(instance)
    registerWebLanguageAliases(instance)
    expect(monaco.languages.register).toHaveBeenCalledTimes(1)
    expect(monaco.languages.onLanguageEncountered).toHaveBeenCalledTimes(1)
    expect(registrations.flatMap((language) => language.mimetypes)).toEqual([
      "application/json", "application/ld+json", "application/manifest+json", "importmap", "speculationrules",
    ])
  })

  it("initializes JSON tokens on the first embedded encounter and releases the temporary model", () => {
    const dispose = vi.fn()
    const onLanguageEncountered = vi.fn()
    const createModel = vi.fn(() => ({ dispose }))
    const monaco = { languages: {
      getLanguages: () => [], register: vi.fn(), onLanguageEncountered,
    }, editor: { createModel } }
    registerWebLanguageAliases(monaco as unknown as Parameters<typeof registerWebLanguageAliases>[0])
    expect(createModel).not.toHaveBeenCalled()
    expect(onLanguageEncountered.mock.calls[0][0]).toBe("json")
    onLanguageEncountered.mock.calls[0][1]()
    expect(createModel).toHaveBeenCalledExactlyOnceWith("", "json")
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
