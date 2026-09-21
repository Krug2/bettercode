import { describe, expect, it } from "vitest"
import { toolNameCategory } from "./tool-name-category"

describe("provider tool naming boundaries", () => {
  it("keeps collaboration ahead of file and command labels for Claude", () => {
    expect(toolNameCategory("Sub-AgentShellWrite", "claude")).toBe("collab_agent_tool_call")
    expect(toolNameCategory("TASK", "claude-terminal")).toBe("collab_agent_tool_call")
    expect(toolNameCategory("task_list", "claude")).toBe("dynamic_tool_call")
  })

  it("preserves each provider's precedence for overlapping names", () => {
    expect(toolNameCategory("web_mcp_image_task", "compat")).toBe("web_search")
    expect(toolNameCategory("web_mcp_image_task", "claude")).toBe("mcp_tool_call")
    expect(toolNameCategory("bash_agent", "compat")).toBe("command_execution")
    expect(toolNameCategory("bash_agent", "claude")).toBe("collab_agent_tool_call")
  })

  it("retains the terminal adapter's narrower replacement convention", () => {
    expect(toolNameCategory("replace", "claude")).toBe("file_change")
    expect(toolNameCategory("replace", "claude-terminal")).toBe("dynamic_tool_call")
    expect(toolNameCategory("read", "compat")).toBe("dynamic_tool_call")
  })
})
