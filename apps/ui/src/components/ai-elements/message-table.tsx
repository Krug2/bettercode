import { useRef, useState, type ComponentProps } from "react"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MaximizeIcon,
  Table2Icon,
} from "lucide-react"
import { copyText } from "@/lib/clipboard"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

/** Serialize visible cells only; provider text never becomes clipboard HTML. */
function tableText(
  table: HTMLTableElement | null,
  separator: "\t" | ","
): string {
  if (!table) return ""
  return Array.from(table.rows, (row) =>
    Array.from(row.cells, (cell) => {
      const value = (cell.textContent ?? "").trim()
      return separator === ","
        ? `"${value.replaceAll('"', '""')}"`
        : value.replace(/[\t\r\n]+/g, " ")
    }).join(separator)
  ).join("\n")
}

export function MessageTable({
  children,
  node: _node,
  ...props
}: ComponentProps<"table"> & { node?: unknown }) {
  const tableRef = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="message-table">
      <div className="message-table-toolbar">
        <span>
          <Table2Icon aria-hidden="true" /> Table
        </span>
        <div>
          <button
            type="button"
            aria-label={copied ? "Table copied" : "Copy table"}
            title={copied ? "Copied" : "Copy table"}
            onClick={async () =>
              setCopied(await copyText(tableText(tableRef.current, "\t")))
            }
            onBlur={() => setCopied(false)}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            aria-label="Download table as CSV"
            title="Download CSV"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([tableText(tableRef.current, ",")], {
                  type: "text/csv;charset=utf-8",
                })
              )
              const link = document.createElement("a")
              link.href = url
              link.download = "table.csv"
              link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            aria-label="Expand table"
            title="Expand table"
            onClick={() => setExpanded(true)}
          >
            <MaximizeIcon />
          </button>
        </div>
      </div>
      <div
        className="message-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Table, scroll for more columns"
      >
        <table {...props} ref={tableRef}>
          {children}
        </table>
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-6xl sm:max-w-6xl">
          <DialogTitle>Table</DialogTitle>
          <div
            className="message-response message-table-scroll max-h-[75vh]"
            tabIndex={0}
            role="region"
            aria-label="Expanded table"
          >
            <table {...props}>{children}</table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
