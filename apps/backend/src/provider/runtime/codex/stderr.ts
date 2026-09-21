const ANSI_ESCAPE_RE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`,
  "g",
);

const CODEX_LOG_LINE_RE = /^(?<ts>\d{4}-\d{2}-\d{2}T\S+)\s+(?<level>TRACE|DEBUG|INFO|WARN|ERROR)\s+(?<scope>[^:]+):\s*(?<message>.*)$/;

const BENIGN_SNIPPETS: ReadonlyArray<string> = [
  "state db missing rollout path",
  "state db record_discrepancy",
];

const FATAL_SNIPPETS: ReadonlyArray<string> = [
  "failed to connect to websocket",
];

export interface CodexStderrLine {
  readonly raw: string;
  readonly level: "trace" | "debug" | "info" | "warn" | "error" | "unknown";
  readonly message: string;
  readonly fatal: boolean;
  readonly benign: boolean;
}

export function classifyCodexStderrLine(line: string): CodexStderrLine | null {
  const clean = line.replace(ANSI_ESCAPE_RE, "").trim();
  if (!clean) return null;
  const match = CODEX_LOG_LINE_RE.exec(clean);
  if (!match || !match.groups) {
    return {
      raw: clean,
      level: "unknown",
      message: clean,
      fatal: FATAL_SNIPPETS.some((s) => clean.toLowerCase().includes(s)),
      benign: BENIGN_SNIPPETS.some((s) => clean.toLowerCase().includes(s)),
    };
  }
  const levelRaw = match.groups.level.toLowerCase();
  const level = (["trace", "debug", "info", "warn", "error"].includes(levelRaw)
    ? levelRaw
    : "unknown") as CodexStderrLine["level"];
  const message = match.groups.message.trim();
  const lower = message.toLowerCase();
  return {
    raw: clean,
    level,
    message,
    fatal: FATAL_SNIPPETS.some((s) => lower.includes(s)),
    benign: BENIGN_SNIPPETS.some((s) => lower.includes(s)),
  };
}

export function isRecoverableResumeMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "not found",
    "missing thread",
    "no such thread",
    "unknown thread",
    "does not exist",
  ].some((s) => lower.includes(s));
}
