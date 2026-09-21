export interface MarketplaceItem {
  id: string
  name: string
  description: string
  category: "provider" | "mcp" | "skill"
  icon?: string
  installs?: number
  /** Skill: skills.sh source repo (`owner/repo`) the install is fetched from */
  source?: string
  /** Skill: skill name inside a multi-skill repo (passed as `npx skills add -s`) */
  skillName?: string
  /** MCP: command to start the server */
  command?: string
  /** MCP: arguments for the command */
  args?: string[]
  /** MCP: environment variables needed */
  env?: string[]
  /** Skill: URL to fetch the full skill content from */
  contentUrl?: string
  /** Provider: installation source shown in the UI */
  installSource?: "bundled-default"
}

const base = import.meta.env.BASE_URL || "/"
function icon(path: string) { return `${base.endsWith("/") ? base : base + "/"}${path}` }

export const MARKETPLACE_CATALOG: MarketplaceItem[] = [
  // Providers — Claude CLI used to live here as a bundled plugin;
  // promoted to a native backend builtin (src/lib/builtin-providers.ts)
  // so the marketplace catalog no longer needs an entry for it.

  // MCP Servers — with connection info
  { id: "mcp-supabase", name: "Supabase", description: "Database, auth, storage, realtime subscriptions", category: "mcp", icon: icon("icons/services/supabase.svg"), command: "npx", args: ["-y", "@supabase/mcp-server"], env: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] },
  { id: "mcp-vercel", name: "Vercel", description: "Deploy, preview, manage projects and domains", category: "mcp", icon: icon("icons/services/vercel.svg"), command: "npx", args: ["-y", "@vercel/mcp-server"], env: ["VERCEL_TOKEN"] },
  { id: "mcp-figma", name: "Figma", description: "Read design files, inspect components and styles", category: "mcp", icon: icon("icons/services/figma.svg"), command: "npx", args: ["-y", "@anthropic/mcp-server-figma"], env: ["FIGMA_ACCESS_TOKEN"] },
  { id: "mcp-github", name: "GitHub", description: "Repos, PRs, issues, code search, actions", category: "mcp", icon: icon("icons/services/github.svg"), command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: ["GITHUB_PERSONAL_ACCESS_TOKEN"] },
  { id: "mcp-context7", name: "Context7", description: "Live documentation for any library or framework", category: "mcp", command: "npx", args: ["-y", "@context7/mcp-server"] },
  { id: "mcp-paper", name: "Paper", description: "Search and read research papers", category: "mcp", command: "npx", args: ["-y", "@anthropic/mcp-server-paper"] },
  { id: "mcp-slack", name: "Slack", description: "Read and send channel messages, threads", category: "mcp", command: "npx", args: ["-y", "@anthropic/mcp-server-slack"], env: ["SLACK_BOT_TOKEN"] },
  { id: "mcp-linear", name: "Linear", description: "Issue tracking, projects, team workflows", category: "mcp", icon: icon("icons/services/linear.svg"), command: "npx", args: ["-y", "@anthropic/mcp-server-linear"], env: ["LINEAR_API_KEY"] },
  { id: "mcp-notion", name: "Notion", description: "Pages, databases, search across workspace", category: "mcp", icon: icon("icons/services/notion.svg"), command: "npx", args: ["-y", "@anthropic/mcp-server-notion"], env: ["NOTION_TOKEN"] },
  { id: "mcp-stripe", name: "Stripe", description: "Payments, subscriptions, invoices, customers", category: "mcp", icon: icon("icons/services/stripe.svg"), command: "npx", args: ["-y", "@anthropic/mcp-server-stripe"], env: ["STRIPE_SECRET_KEY"] },
  { id: "mcp-cloudflare", name: "Cloudflare", description: "Workers, DNS, pages, R2 storage", category: "mcp", icon: icon("icons/services/cloudflare.svg"), command: "npx", args: ["-y", "@anthropic/mcp-server-cloudflare"], env: ["CLOUDFLARE_API_TOKEN"] },
  { id: "mcp-firebase", name: "Firebase", description: "Firestore, auth, hosting", category: "mcp", icon: icon("icons/services/firebase.svg") },
  { id: "mcp-planetscale", name: "PlanetScale", description: "MySQL serverless DB", category: "mcp", icon: icon("icons/services/planetscale.svg") },
  { id: "mcp-docker", name: "Docker", description: "Container management", category: "mcp", icon: icon("icons/services/docker.svg") },
  { id: "mcp-aws", name: "AWS", description: "Cloud infrastructure", category: "mcp" },

  // Skills — installed for real from the skills.sh registry via
  // `npx skills add <source> -s <skillName>` (see apps/shell/skills-sh.cjs).
  // `source` MUST be a real GitHub repo the skills CLI can resolve;
  // entries without one were dropped when the stub installer was replaced.
  { id: "find-skills", name: "Find Skills", description: "Discover and search skills", category: "skill", source: "vercel-labs/skills", skillName: "find-skills" },
  { id: "vercel-react-best-practices", name: "React Best Practices", description: "React patterns for Vercel", category: "skill", source: "vercel-labs/agent-skills", skillName: "react-best-practices" },
  { id: "frontend-design", name: "Frontend Design", description: "UI/UX focused assistance", category: "skill", source: "anthropics/skills", skillName: "frontend-design" },
  { id: "web-design-guidelines", name: "Web Design Guidelines", description: "Web design standards", category: "skill", source: "vercel-labs/agent-skills", skillName: "web-design-guidelines" },
  { id: "remotion-best-practices", name: "Remotion Video", description: "Remotion video library", category: "skill", source: "remotion-dev/skills" },
  { id: "agent-browser", name: "Agent Browser", description: "Browser automation", category: "skill", source: "vercel-labs/agent-browser" },
  { id: "skill-creator", name: "Skill Creator", description: "Create new agent skills", category: "skill", source: "anthropics/skills", skillName: "skill-creator" },
  { id: "seo-audit", name: "SEO Audit", description: "SEO analysis and auditing", category: "skill", source: "coreyhaines31/marketingskills", skillName: "seo-audit" },
  { id: "pdf", name: "PDF", description: "PDF file handling", category: "skill", source: "anthropics/skills", skillName: "pdf" },
  { id: "pptx", name: "PowerPoint", description: "Presentation generation", category: "skill", source: "anthropics/skills", skillName: "pptx" },
  { id: "docx", name: "Word Docs", description: "Word document creation", category: "skill", source: "anthropics/skills", skillName: "docx" },
  { id: "xlsx", name: "Excel", description: "Spreadsheet manipulation", category: "skill", source: "anthropics/skills", skillName: "xlsx" },
  { id: "mcp-builder", name: "MCP Builder", description: "Build MCP servers", category: "skill", source: "anthropics/skills", skillName: "mcp-builder" },
  { id: "nextjs-best-practices", name: "Next.js Best Practices", description: "Next.js patterns and conventions", category: "skill", source: "vercel-labs/agent-skills", skillName: "nextjs-best-practices" },
  { id: "tailwind-best-practices", name: "Tailwind Best Practices", description: "Tailwind CSS patterns", category: "skill", source: "vercel-labs/agent-skills", skillName: "tailwind-best-practices" },
]
