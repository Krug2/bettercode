/**
 * BetterC0de Browser Preview — Webview Preload Script
 * Based on Cursor's preload-webview-browser.js architecture.
 * Exposes window.cursorBrowser bridge via contextBridge, handles dialog overrides,
 * keyboard shortcuts, and local network polyfill.
 */
const { ipcRenderer, contextBridge, webFrame } = require("electron");

const IS_MAC = process.platform === "darwin";
const WORKSPACE_BROWSER = process.argv.includes("--betterc0de-workspace-browser");

ipcRenderer.on("workspace-open-url", (_event, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) ipcRenderer.sendToHost("workspace-open-url", url);
});

// Set by the main process's webview policy, never by page JavaScript. Capture
// pinch/Ctrl-wheel before Chromium or the page can zoom the embedded document.
if (process.argv.includes("--betterc0de-canvas-preview")) {
  webFrame.setVisualZoomLevelLimits(1, 1);
  window.addEventListener("wheel", (event) => {
    if (!event.isTrusted || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    ipcRenderer.sendToHost("canvas-wheel", {
      x: event.clientX / Math.max(1, window.innerWidth),
      y: event.clientY / Math.max(1, window.innerHeight),
      deltaY: event.deltaY * unit,
    });
  }, { capture: true, passive: false });
}

// ── Whitelisted IPC channels ─────────────────────────────────────────────────
const ALLOWED_CHANNELS = [
  "element-selected",
  "element-updated",
  "element-picked",
  "css-inspector-style-change",
  "dom-tree",
  "console-batch",
  "console-entry",
  "focus-url-bar",
  "open-url-side-group",
  "open-url-new-tab",
  "focus-composer-input",
  "css-inspector-undo",
  "css-inspector-redo",
  "show-dialog",
  "browser-error-action",
  "apply-style-result",
  "highlight-result",
];

const bridge = {
  send: (channel, ...args) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.sendToHost(channel, ...args);
    }
  },
};

try {
  contextBridge.exposeInMainWorld("cursorBrowser", bridge);
} catch (e) {
  console.error("[BrowserPreview Preload] Failed to expose bridge:", e);
}

// ── Local Network Permission Polyfill ────────────────────────────────────────
function injectLocalNetworkPolyfill() {
  try {
    webFrame.executeJavaScript(`
      (function() {
        if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return;
        if (navigator.permissions.__localNetworkPolyfillApplied) return;
        navigator.permissions.__localNetworkPolyfillApplied = true;
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = async function(descriptor) {
          if (descriptor && (descriptor.name === 'local-network-access' || descriptor.name === 'local-network')) {
            return { state: 'granted', name: descriptor.name, onchange: null, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; } };
          }
          return originalQuery(descriptor);
        };
      })();
    `).catch((e) => {
      console.error("[BrowserPreview Preload] Failed to inject local network polyfill:", e);
    });
  } catch (e) {
    console.error("[BrowserPreview Preload] Failed to inject local network polyfill:", e);
  }
}

// ── Dialog Overrides (non-blocking alert/confirm/prompt) ─────────────────────
function injectDialogOverrides() {
  const script = `
    (function() {
      if (window.__bcDialogOverridesApplied) return;
      window.__bcDialogOverridesApplied = true;

      window.__bcDialogConfig = { confirmResult: true, promptResult: null, dialogHistory: [] };

      window.__bcSetDialogConfig = function(config) {
        if (typeof config.confirmResult === 'boolean') window.__bcDialogConfig.confirmResult = config.confirmResult;
        if (config.promptResult !== undefined) window.__bcDialogConfig.promptResult = config.promptResult;
      };

      window.__bcGetDialogHistory = function() { return window.__bcDialogConfig.dialogHistory.slice(); };
      window.__bcClearDialogHistory = function() { window.__bcDialogConfig.dialogHistory = []; };

      function rememberDialog(entry) {
        for (var key of ['message', 'defaultValue', 'result']) {
          if (typeof entry[key] === 'string') entry[key] = entry[key].slice(0, 4096);
          else if (entry[key] !== null && typeof entry[key] === 'object') entry[key] = String(entry[key]).slice(0, 4096);
        }
        var history = window.__bcDialogConfig.dialogHistory;
        history.push(entry);
        if (history.length > 1000) history.splice(0, history.length - 1000);
      }

      window.alert = function(message) {
        var msgStr = String(message ?? '');
        console.log('[BetterC0de Browser] Dialog suppressed: alert - ' + msgStr);
        rememberDialog({ type: 'alert', message: msgStr, timestamp: Date.now() });
        return undefined;
      };

      window.confirm = function(message) {
        var msgStr = String(message ?? '');
        var result = window.__bcDialogConfig.confirmResult;
        console.log('[BetterC0de Browser] Dialog suppressed: confirm - ' + msgStr + ' (returning ' + result + ')');
        rememberDialog({ type: 'confirm', message: msgStr, result: result, timestamp: Date.now() });
        return result;
      };

      window.prompt = function(message, defaultValue) {
        var msgStr = String(message ?? '');
        var defVal = defaultValue ?? '';
        var configuredResult = window.__bcDialogConfig.promptResult;
        var result = configuredResult !== null ? configuredResult : defVal;
        console.log('[BetterC0de Browser] Dialog suppressed: prompt - ' + msgStr + ' (returning: ' + result + ')');
        rememberDialog({ type: 'prompt', message: msgStr, defaultValue: defVal, result: result, timestamp: Date.now() });
        return result;
      };
    })();
  `;
  try {
    webFrame.executeJavaScript(script).catch((e) => {
      console.error("[BrowserPreview Preload] Failed to inject dialog overrides:", e);
    });
  } catch (e) {
    console.error("[BrowserPreview Preload] Failed to inject dialog overrides:", e);
  }
}

// ── Run early injections ─────────────────────────────────────────────────────
if (!WORKSPACE_BROWSER) {
  injectLocalNetworkPolyfill();
  injectDialogOverrides();
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  // Re-inject dialog overrides after DOM ready (some SPAs reset window objects)
  if (!WORKSPACE_BROWSER) injectDialogOverrides();

  // Alt+Click on links opens in side group
  document.addEventListener("click", (e) => {
    if (!e.altKey) return;
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.href;
    if (!href || href.startsWith("javascript:")) return;
    e.preventDefault();
    e.stopPropagation();
    if (WORKSPACE_BROWSER) ipcRenderer.sendToHost("workspace-open-url", href);
    else ipcRenderer.sendToHost("open-url-side-group", { url: href });
  }, true);
});

document.addEventListener("keydown", (e) => {
  if (!e.isTrusted) return;

  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const key = e.key.toLowerCase();
  let shortcut;

  // Mod only
  if (mod && !shift && !alt) {
    switch (key) {
      case "r": shortcut = "reload-page"; break;
      case "l": shortcut = "focus-url-bar"; break;
      case "t": shortcut = "new-browser-tab"; break;
      case "i": shortcut = "focus-composer"; break;
      case "b": shortcut = "toggle-sidebar"; break;
      case "w": shortcut = "close-browser-tab"; break;
      case "=": case "+": shortcut = "zoom-in"; break;
      case "-": shortcut = "zoom-out"; break;
      case "0": shortcut = "zoom-reset"; break;
      case "z": shortcut = "undo"; break;
      case "a": shortcut = "select-all"; break;
      case "c": shortcut = "copy"; break;
      case "v": shortcut = "paste"; break;
      case "x": shortcut = "cut"; break;
      case "[": shortcut = "navigate-back"; break;
      case "]": shortcut = "navigate-forward"; break;
    }
  }

  // Mod+Shift
  if (mod && shift && !alt) {
    switch (key) {
      case "i": shortcut = "open-devtools"; break;
      case "j": shortcut = "toggle-preview"; break;
      case "z": shortcut = "redo"; break;
    }
  }

  // Alt only
  if (alt && !mod && !shift) {
    switch (key) {
      case "arrowleft": shortcut = "navigate-back"; break;
      case "arrowright": shortcut = "navigate-forward"; break;
    }
  }

  // No modifiers
  if (!mod && !shift && !alt) {
    switch (key) {
      case "f5": shortcut = "reload-page"; break;
      case "f12": shortcut = "open-devtools"; break;
    }
  }

  // Mac: Cmd+Alt+I/C/J for devtools
  if (IS_MAC && e.metaKey && e.altKey && !shift) {
    if (key === "i" || key === "c" || key === "j") shortcut = "open-devtools";
  }

  if (shortcut) {
    if (WORKSPACE_BROWSER && ["undo", "redo", "select-all", "copy", "paste", "cut"].includes(shortcut)) return;
    e.preventDefault();
    ipcRenderer.sendToHost("keyboard-shortcut", { shortcut });
  }

  // Forward all keydown events for host to track
  ipcRenderer.sendToHost("did-keydown", {
    key: e.key, keyCode: e.keyCode, code: e.code,
    shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, repeat: e.repeat,
  });
}, true);
