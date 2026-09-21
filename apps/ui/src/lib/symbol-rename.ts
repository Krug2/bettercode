// Conservative binding-name validation for TypeScript and JavaScript.
const reservedNames = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with implements interface let package private protected public " +
    "static yield await eval arguments"
  ).split(" ")
)

export function isRenameableIdentifier(
  value: string | null | undefined
): boolean {
  return (
    typeof value === "string" &&
    /^[$_\p{ID_Start}](?:[$_\p{ID_Continue}]|\u200C|\u200D)*$/u.test(value) &&
    !reservedNames.has(value)
  )
}
