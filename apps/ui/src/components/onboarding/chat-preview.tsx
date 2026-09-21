import { cn } from "@/lib/utils"
import { assetUrl } from "@/lib/asset-url"
import {
  PlusIcon,
  SendIcon,
  MicIcon,
  BotIcon,
  MonitorIcon,
  PaletteIcon,
  SettingsIcon,
} from "lucide-react"

/** Live preview of the chat interface, rendered with actual CSS variables */
export function ChatPreview({ isSimple }: { isSimple: boolean }) {
  return (
    <div
      className="flex h-full w-full"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      {/* Sidebar */}
      <div
        className="flex w-[200px] shrink-0 flex-col border-r"
        style={{
          background: "var(--sidebar)",
          color: "var(--sidebar-foreground)",
          borderColor: "var(--sidebar-border)",
        }}
      >
        {/* Sidebar header */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <img src={assetUrl("favicon.svg")} alt="" className="size-4" />
          <span className="text-[10px] font-semibold">BetterC0de</span>
        </div>

        {/* New Agent button */}
        <div className="px-2 pb-1">
          <div
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
            style={{ background: "var(--sidebar-accent)" }}
          >
            <PlusIcon
              className="size-3"
              style={{ color: "var(--sidebar-primary)" }}
            />
            <span className="text-[9px] font-medium">New Agent</span>
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 space-y-px overflow-hidden px-2 py-1">
          <p
            className="px-1.5 py-1 text-[8px] font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            Today
          </p>
          {["Fix login API bug", "Dashboard redesign", "Add dark mode"].map(
            (name, i) => (
              <div
                key={name}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[9px]",
                  i === 0 ? "font-medium" : ""
                )}
                style={
                  i === 0
                    ? {
                        background: "var(--sidebar-accent)",
                        color: "var(--sidebar-accent-foreground)",
                      }
                    : { color: "var(--muted-foreground)" }
                }
              >
                {name}
              </div>
            )
          )}
          <p
            className="px-1.5 pt-2 pb-1 text-[8px] font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            Yesterday
          </p>
          {["Setup CI/CD pipeline", "Refactor auth"].map((name) => (
            <div
              key={name}
              className="rounded-md px-2 py-1.5 text-[9px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              {name}
            </div>
          ))}
        </div>

        {/* Sidebar footer */}
        <div
          className="border-t px-2 py-2"
          style={{ borderColor: "var(--sidebar-border)" }}
        >
          {isSimple ? (
            <div
              className="flex items-center gap-0.5 rounded-md p-0.5"
              style={{ background: "var(--sidebar-accent)", opacity: 0.5 }}
            >
              <div
                className="flex flex-1 items-center justify-center gap-1 rounded py-0.5"
                style={{
                  background: "var(--sidebar-accent)",
                  color: "var(--sidebar-foreground)",
                }}
              >
                <BotIcon className="size-2.5" />
                <span className="text-[8px]">Agent</span>
              </div>
              <div className="flex flex-1 items-center justify-center gap-1 rounded py-0.5">
                <MonitorIcon
                  className="size-2.5"
                  style={{ color: "var(--muted-foreground)" }}
                />
                <span
                  className="text-[8px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Editor
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div
                className="flex items-center gap-1.5 rounded-md px-2 py-1"
                style={{ background: "var(--secondary)" }}
              >
                <BotIcon className="size-2.5" />
                <span className="text-[8px]">Agent</span>
              </div>
              <div
                className="flex items-center gap-1.5 rounded-md px-2 py-1"
                style={{ color: "var(--muted-foreground)" }}
              >
                <MonitorIcon className="size-2.5" />
                <span className="text-[8px]">Editor</span>
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 px-1">
            <div
              className="flex size-5 items-center justify-center rounded-full text-[7px] font-bold"
              style={{
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                opacity: 0.5,
              }}
            >
              U
            </div>
            <span
              className="flex-1 text-[8px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              User
            </span>
            <PaletteIcon
              className="size-3"
              style={{ color: "var(--muted-foreground)" }}
            />
            <SettingsIcon
              className="size-3"
              style={{ color: "var(--muted-foreground)" }}
            />
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-hidden px-6 py-4">
          <div
            className={cn(
              "mx-auto space-y-4",
              isSimple ? "max-w-[360px]" : "max-w-[480px]"
            )}
          >
            {/* User message */}
            <div className="flex justify-end">
              <div
                className="rounded-2xl rounded-br-sm px-3 py-2 text-[9px]"
                style={{
                  background: "var(--secondary)",
                  color: "var(--secondary-foreground)",
                }}
              >
                How do I fix the login API timeout?
              </div>
            </div>

            {/* Assistant message */}
            <div className="flex gap-2">
              <div
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                }}
              >
                <BotIcon className="size-2.5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[9px] leading-relaxed">
                  The timeout issue is likely caused by the middleware not
                  passing the abort signal. Here&apos;s how to fix it:
                </p>
                <div
                  className="rounded-lg px-3 py-2 font-mono text-[8px] leading-relaxed"
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span style={{ color: "var(--muted-foreground)" }}>
                    // api/login.ts
                  </span>
                  <br />
                  <span>const res = await fetch(url, {"{"}</span>
                  <br />
                  <span>&nbsp;&nbsp;signal: controller.signal,</span>
                  <br />
                  <span>&nbsp;&nbsp;timeout: 30000</span>
                  <br />
                  <span>{"}"});</span>
                </div>
                <p className="text-[9px] leading-relaxed">
                  This ensures the request respects the timeout and cancels
                  properly.
                </p>
              </div>
            </div>

            {/* User message 2 */}
            <div className="flex justify-end">
              <div
                className="rounded-2xl rounded-br-sm px-3 py-2 text-[9px]"
                style={{
                  background: "var(--secondary)",
                  color: "var(--secondary-foreground)",
                }}
              >
                Can you also add retry logic?
              </div>
            </div>
          </div>
        </div>

        {/* Input area */}
        <div className="px-6 pb-4">
          <div
            className={cn(
              "mx-auto",
              isSimple ? "max-w-[360px]" : "max-w-[480px]"
            )}
          >
            {/* Mode/Model selectors */}
            {!isSimple && (
              <div className="mb-1.5 flex items-center gap-1.5">
                <div
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[8px]"
                  style={{ background: "var(--secondary)" }}
                >
                  <span className="font-medium">Agent</span>
                </div>
                <div
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[8px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Claude 4 Opus
                </div>
              </div>
            )}
            <div
              className="flex items-center gap-2 rounded-xl border px-3 py-2"
              style={{
                borderColor: "var(--border)",
                background: "var(--background)",
              }}
            >
              <span
                className="flex-1 text-[9px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {isSimple ? "Ask anything..." : "Ask BetterC0de..."}
              </span>
              <div className="flex items-center gap-1.5">
                <MicIcon
                  className="size-3"
                  style={{ color: "var(--muted-foreground)" }}
                />
                <div
                  className="flex size-5 items-center justify-center rounded-md"
                  style={{ background: "var(--primary)" }}
                >
                  <SendIcon
                    className="size-2.5"
                    style={{ color: "var(--primary-foreground)" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
