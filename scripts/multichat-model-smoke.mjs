import { build } from "vite"
import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const smokeFunction = process.argv.includes("--terminal") ? "runTerminalSmoke" : process.argv.includes("--composer") ? "runComposerSmoke" : "runMultichatSmoke"
const scratch = await mkdtemp(
  path.join(tmpdir(), "betterc0de-multichat-smoke-")
)
const stubs = {
  "lib/use-deepgram": "export const useDeepgram = () => ({ isRecording: false, start: callbacks => { window.fixtureVoice = callbacks }, stop: () => {} })",
  "components/layout/chat-top-bar": "export const ChatTopBar = () => null",
  "components/chat/chat-transcript": "export const ChatTranscript = () => null",
  "components/chat/provider-status-banner":
    "export const ProviderStatusBanner = () => null",
  "components/layout/agent-terminal-diff":
    "export const AgentTerminalDiff = () => null",
  "hooks/use-chat-streaming-state":
    "export const useChatStreamingState = () => ({ allPlans: [], isStreaming: false })",
  "components/chat/chat-input-area": `
    import { createElement } from "react"
    import { PromptInputProvider } from "@/components/ai-elements/prompt-input"
    import { ComposerMinimalFooter } from "@/components/chat/composer-minimal-footer"
    export const ChatInputArea = ({ composerProps }) => createElement(PromptInputProvider, null, createElement(ComposerMinimalFooter, composerProps))
  `,
}

try {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: { "@": path.join(root, "apps/ui/src") } },
    esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [
      {
        name: "isolated-composer-fixture",
        enforce: "pre",
        resolveId(id) {
          const normalized = id.replaceAll("\\", "/").replace(/\.tsx?$/, "")
          const name = Object.keys(stubs).find((key) =>
            normalized.endsWith(`/${key}`)
          )
          return name ? `\0fixture:${name}` : null
        },
        load(id) {
          return id.startsWith("\0fixture:") ? stubs[id.slice(9)] : null
        },
      },
    ],
    build: {
      outDir: scratch,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: path.join(root, "scripts/fixtures/multichat-model-picker.tsx"),
        name: "MultichatSmoke",
        formats: ["iife"],
        fileName: () => "fixture.js",
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
        onwarn(warning, warn) {
          if (
            warning.code !== "MODULE_LEVEL_DIRECTIVE" &&
            warning.code !== "SOURCEMAP_ERROR"
          )
            warn(warning)
        },
      },
    },
  })
  await writeFile(
    path.join(scratch, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; } .pointer-events-none { pointer-events: none; } .opacity-0 { opacity: 0; }
  </style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`
  )
  const launcher = path.join(scratch, "main.cjs")
  await writeFile(
    launcher,
    `
    const { app, BrowserWindow } = require("electron")
    const path = require("node:path")
    app.setPath("userData", path.join(__dirname, "profile"))
    const timeout = setTimeout(() => { console.error("Multichat smoke timed out"); app.exit(1) }, 120000)
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      window.webContents.on("console-message", (event) => {
        if (event.level === "error") console.error(event.message)
        else if (event.message.startsWith("[smoke]")) console.log(event.message)
      })
      console.log("[smoke] Loading isolated renderer")
      await window.loadFile(path.join(__dirname, "index.html"))
      console.log("[smoke] Renderer loaded")
      const result = await window.webContents.executeJavaScript("window.${smokeFunction}().catch(error => { console.error(error.stack + ' DOM: ' + document.body.innerHTML); throw error })")
      console.log(result)
      clearTimeout(timeout)
      app.exit(0)
    }).catch((error) => { console.error(error); app.exit(1) })
  `
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = createRequire(import.meta.url)("electron")
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [launcher], {
      stdio: "inherit",
      windowsHide: true,
      env,
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("Electron fixture did not exit"))
    }, 135000)
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      code === 0
        ? resolve()
        : reject(new Error(`Electron fixture exited ${code}`))
    })
  })
  if (
    path.dirname(scratch) !== path.resolve(tmpdir()) ||
    !path.basename(scratch).startsWith("betterc0de-multichat-smoke-")
  )
    throw new Error("Invalid fixture cleanup path")
  await rm(scratch, { recursive: true, force: true })
} catch (error) {
  console.error(error)
  console.error(`Fixture artifacts: ${scratch}`)
  process.exitCode = 1
}
