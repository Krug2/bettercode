export function isMacTitlebarPlatform(
  electronPlatform: NodeJS.Platform | undefined,
  navigatorPlatform: string | undefined
): boolean {
  if (electronPlatform === "darwin") return true
  return (navigatorPlatform ?? "").toLowerCase().includes("mac")
}

export function shouldRenderCustomWindowControls(input: {
  electronPlatform: NodeJS.Platform | undefined
  navigatorPlatform: string | undefined
  hasWindowControlIpc: boolean
}): boolean {
  return (
    input.hasWindowControlIpc &&
    !isMacTitlebarPlatform(input.electronPlatform, input.navigatorPlatform)
  )
}
