import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { copyText } from "@/lib/clipboard"

export function ConsoleMessage({ text, copyValue = text }: { text: string; copyValue?: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="group flex min-w-0 flex-1 items-start gap-2">
    <span className="min-w-0 flex-1 select-text break-all whitespace-pre-wrap">{text}</span>
    <button
      type="button"
      aria-label={copied ? "Message copied" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-ring"
      onClick={async () => setCopied(await copyText(copyValue))}
      onBlur={() => setCopied(false)}
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </button>
  </div>
}
