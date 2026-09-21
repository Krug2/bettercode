export interface SlashCommandSpec<TContext, TResult> {
  readonly names: readonly string[]
  readonly run: (context: TContext) => TResult
}

export function indexSlashCommands<TContext, TResult>(
  specs: readonly SlashCommandSpec<TContext, TResult>[]
): ReadonlyMap<string, SlashCommandSpec<TContext, TResult>> {
  const index = new Map<string, SlashCommandSpec<TContext, TResult>>()
  for (const spec of specs) {
    for (const name of spec.names) {
      index.set(`/${name}`, spec)
    }
  }
  return index
}

export function dispatchSlashCommand<TContext, TResult>(
  command: string,
  context: TContext,
  index: ReadonlyMap<string, SlashCommandSpec<TContext, TResult>>
): TResult | undefined {
  const spec = index.get(command)
  return spec ? spec.run(context) : undefined
}
