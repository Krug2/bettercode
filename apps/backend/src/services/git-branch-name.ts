const FRAGMENT_LIMIT = 64

/** Converts generated prose into a stable ASCII ref fragment without interpreting Git syntax. */
export function branchFragment(text: string): string {
  const characters: string[] = []
  for (const character of text.toLowerCase()) {
    if (character === "'" || character === '"' || character === "`") continue
    const code = character.charCodeAt(0)
    const isLetterOrDigit = (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
    if (isLetterOrDigit) {
      characters.push(character)
    } else {
      if (!characters.length) continue
      const separator = character === "/" || character === "_" ? character : "-"
      if (separator !== "_" && characters.at(-1) === separator) continue
      characters.push(separator)
    }
    if (characters.length === FRAGMENT_LIMIT) break
  }
  while (characters.length && "/_-".includes(characters.at(-1)!)) characters.pop()
  return characters.join("") || "update"
}

export function featureBranchName(text: string): string {
  const fragment = branchFragment(text)
  return fragment.startsWith("feature/") ? fragment : `feature/${fragment}`
}
