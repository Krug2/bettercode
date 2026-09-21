type GlobToken =
  | { kind: "literal"; value: string }
  | { kind: "character" }
  | { kind: "segment" }
  | { kind: "path" }
  | { kind: "directories" }

/** Compile the supported path-glob subset without a backtracking RegExp.
 * Matching uses O(pattern length * candidate length) work and O(candidate
 * length) memory, including patterns containing many overlapping stars.
 */
export function compileBoundedGlob(
  pattern: string,
  options: {
    caseInsensitive?: boolean
    optionalGlobstarDirectory?: boolean
  } = {}
): (candidate: string) => boolean {
  const canonical = (value: string): string => {
    if (!options.caseInsensitive) return value
    const upper = value.toUpperCase()
    // Match JavaScript's non-Unicode /i canonicalization of UTF-16 units.
    return upper.length !== 1 ||
      (value.charCodeAt(0) >= 128 && upper.charCodeAt(0) < 128)
      ? value
      : upper
  }
  const tokens: GlobToken[] = []
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1
        if (
          options.optionalGlobstarDirectory !== false &&
          pattern[index + 1] === "/"
        ) {
          index += 1
          tokens.push({ kind: "directories" })
        } else tokens.push({ kind: "path" })
      } else tokens.push({ kind: "segment" })
    } else if (character === "?") tokens.push({ kind: "character" })
    else tokens.push({ kind: "literal", value: canonical(character) })
  }

  return (candidate) => {
    let previous = new Uint8Array(candidate.length + 1)
    previous[0] = 1
    const characters = candidate.split("")
    const folded = characters.map(canonical)
    for (const token of tokens) {
      const next = new Uint8Array(previous.length)
      if (token.kind === "directories") {
        next.set(previous) // **/ also matches zero directories.
        let consumingDirectory = false
        for (let index = 1; index < next.length; index += 1) {
          const character = characters[index - 1]!
          consumingDirectory =
            (consumingDirectory || previous[index - 1] === 1) &&
            !/[\r\n\u2028\u2029]/.test(character)
          if (consumingDirectory && character === "/") next[index] = 1
        }
      } else if (token.kind === "segment" || token.kind === "path") {
        next[0] = previous[0]!
        for (let index = 1; index < next.length; index += 1) {
          const character = characters[index - 1]!
          const allowed =
            token.kind === "segment"
              ? character !== "/"
              : !/[\r\n\u2028\u2029]/.test(character)
          next[index] = Number(
            previous[index] === 1 || (next[index - 1] === 1 && allowed)
          )
        }
      } else {
        for (let index = 1; index < next.length; index += 1) {
          next[index] = Number(
            previous[index - 1] === 1 &&
              (token.kind === "character"
                ? characters[index - 1] !== "/"
                : folded[index - 1] === token.value)
          )
        }
      }
      previous = next
    }
    return previous[candidate.length] === 1
  }
}
