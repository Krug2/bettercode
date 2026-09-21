import { useState } from "react"
import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react"
import { copyText } from "@/lib/clipboard"
import "./execution-failure.css"

export function ExecutionFailure({
  title,
  message,
  details,
  context,
}: {
  title: string
  message: string
  details?: string
  context?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="execution-failure">
      <div className="execution-failure-heading">
        <CircleAlertIcon aria-hidden="true" />
        <strong>{title}</strong>
        <button
          type="button"
          title={copied ? "Copied" : "Copy error details"}
          aria-label={copied ? "Error details copied" : "Copy error details"}
          onClick={async () =>
            setCopied(
              await copyText(
                [
                  title,
                  context,
                  details?.startsWith(message)
                    ? details
                    : [message, details].filter(Boolean).join("\n\n"),
                ]
                  .filter(Boolean)
                  .join("\n\n")
              )
            )
          }
          onBlur={() => setCopied(false)}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <p>{message}</p>
      {details && (
        <details>
          <summary>Details</summary>
          <pre>{details}</pre>
        </details>
      )}
    </div>
  )
}
