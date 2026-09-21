type ToolFamily = "claude" | "claude-terminal" | "compat"
type CategoryRule = readonly [pattern: RegExp, category: string]

const collaboration: CategoryRule = [/^task$|agent/, "collab_agent_tool_call"]
const execution: CategoryRule = [/bash|command|shell|terminal/, "command_execution"]
const mcp: CategoryRule = [/mcp/, "mcp_tool_call"]
const search: CategoryRule = [/search|grep/, "web_search"]
const rules: Record<ToolFamily, readonly CategoryRule[]> = {
  claude: [collaboration, execution, [/edit|write|file|patch|replace|create|delete/, "file_change"], mcp, search],
  "claude-terminal": [collaboration, execution, [/edit|write|file|patch|create|delete/, "file_change"], mcp, search],
  compat: [
    [/bash|command/, "command_execution"],
    [/edit|write|patch/, "file_change"],
    [/web/, "web_search"],
    mcp,
    [/image/, "image_view"],
    [/task|agent/, "collab_agent_tool_call"],
  ],
}

/** Provider naming conventions classify display activities, never permissions. */
export function toolNameCategory(name: string, family: ToolFamily): string {
  const normalized = name.toLowerCase()
  return rules[family].find(([pattern]) => pattern.test(normalized))?.[1] ?? "dynamic_tool_call"
}
