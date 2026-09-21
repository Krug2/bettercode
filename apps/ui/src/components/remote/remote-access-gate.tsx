import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { LoaderCircle, RotateCw, ShieldCheck, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getRemoteBootstrap,
  pairRemoteBrowser,
} from "@/services/backend/remoteApi"
import { isRemoteRuntime } from "@/services/backend/runtime"

type GateState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "pairing" }
  | { status: "needs-pairing"; error?: string }
  | { status: "disabled" }
  | { status: "error"; message: string }

function takePairingToken(): string {
  const url = new URL(window.location.href)
  const params = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  )
  const token = params.get("token")?.trim() ?? ""
  if (!token) return ""

  // Keep the credential out of screenshots, copied URLs, and browser history
  // as soon as the page has captured it in memory.
  params.delete("token")
  url.hash = params.toString()
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  return token
}

function browserLabel(): string {
  const userAgent = navigator.userAgent
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser"
  const device = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "iPhone or iPad"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Macintosh/i.test(userAgent)
          ? "Mac"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "device"
  return `${browser} on ${device}`
}

export function RemoteAccessGate({ children }: { children: ReactNode }) {
  const remote = isRemoteRuntime()
  const [state, setState] = useState<GateState>(() =>
    remote ? { status: "checking" } : { status: "ready" }
  )
  const [pairingCode, setPairingCode] = useState("")

  const check = useCallback(async (linkToken?: string) => {
    try {
      if (linkToken) {
        setState({ status: "pairing" })
        await pairRemoteBrowser(linkToken, browserLabel())
      }
      const bootstrap = await getRemoteBootstrap()
      if (!bootstrap.enabled) {
        setState({ status: "disabled" })
      } else if (bootstrap.authenticated) {
        setState({ status: "ready" })
      } else {
        setState({ status: "needs-pairing" })
      }
    } catch (error) {
      setState({
        status: linkToken ? "needs-pairing" : "error",
        ...(linkToken
          ? {
              error: error instanceof Error ? error.message : "Pairing failed",
            }
          : {
              message:
                error instanceof Error
                  ? error.message
                  : "Could not reach BetterC0de",
            }),
      } as GateState)
    }
  }, [])

  useEffect(() => {
    if (!remote) return
    void check(takePairingToken())
  }, [check, remote])

  const submitPairingCode = async (event: FormEvent) => {
    event.preventDefault()
    const code = pairingCode.trim()
    if (!code) return
    await check(code)
  }

  if (state.status === "ready") return children

  const loading = state.status === "checking" || state.status === "pairing"
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-xl shadow-black/10 sm:p-8">
        <div className="mb-6 flex size-11 items-center justify-center rounded-xl border border-border bg-muted/60">
          {state.status === "disabled" || state.status === "error" ? (
            <WifiOff className="size-5 text-muted-foreground" />
          ) : loading ? (
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-emerald-500" />
          )}
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          {loading
            ? state.status === "pairing"
              ? "Pairing this device"
              : "Connecting to BetterC0de"
            : state.status === "needs-pairing"
              ? "Pair this device"
              : state.status === "disabled"
                ? "Remote access is off"
                : "BetterC0de is unreachable"}
        </h1>

        {loading ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Verifying the host and its remote session…
          </p>
        ) : state.status === "needs-pairing" ? (
          <form className="mt-5 space-y-4" onSubmit={submitPairingCode}>
            <p className="text-sm leading-6 text-muted-foreground">
              Open a pairing link from the BetterC0de desktop app, or enter the
              one-time code shown under Settings → Remote Access.
            </p>
            <Input
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoFocus
              inputMode="text"
              maxLength={20}
              onChange={(event) => setPairingCode(event.target.value)}
              placeholder="ABCD-EFGH-JKLM"
              spellCheck={false}
              value={pairingCode}
            />
            {state.error ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}
            <Button
              className="w-full"
              disabled={!pairingCode.trim()}
              type="submit"
            >
              Pair and continue
            </Button>
          </form>
        ) : state.status === "disabled" ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Enable Remote Access from the desktop app or run{" "}
            <code>/remote</code>
            in a chat, then open a new pairing link.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {state.message}
            </p>
            <Button
              className="mt-5 w-full gap-2"
              onClick={() => {
                setState({ status: "checking" })
                void check()
              }}
              variant="outline"
            >
              <RotateCw className="size-4" />
              Try again
            </Button>
          </>
        )}

        <p className="mt-6 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
          This device receives access to chats, projects, files, terminals, and
          provider sessions on the host. Pair only devices you trust.
        </p>
      </section>
    </main>
  )
}
