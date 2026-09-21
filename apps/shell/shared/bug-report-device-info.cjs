const os = require("node:os")

function read(callback, fallback = null) {
  try { return callback() } catch { return fallback }
}

function number(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function text(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, 512)
    : null
}

function collectAppMemory(app) {
  const metrics = app.getAppMetrics()
  const sumBytes = (key) => {
    const values = metrics.map((metric) => number(metric.memory?.[key])).filter((value) => value !== null)
    // Electron reports these values in KiB; Node's OS memory values use bytes.
    return values.length ? values.reduce((sum, value) => sum + value, 0) * 1024 : null
  }
  return {
    scope: "electron-processes",
    processCount: metrics.length,
    // Summing working sets can count shared pages more than once.
    workingSetBytesSum: sumBytes("workingSetSize"),
    privateBytesSum: sumBytes("privateBytes"),
  }
}

async function collectGpu(app, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => app.getGPUInfo("complete")).then((info) => ({
        status: "available",
        devices: (Array.isArray(info?.gpuDevice) ? info.gpuDevice : []).slice(0, 8).map((device) => ({
          name: text(device?.deviceString),
          vendor: text(device?.vendorString),
          vendorId: number(device?.vendorId),
          deviceId: number(device?.deviceId),
          active: typeof device?.active === "boolean" ? device.active : null,
          driverVendor: text(device?.driverVendor),
          driverVersion: text(device?.driverVersion),
        })),
        renderer: text(info?.auxAttributes?.glRenderer),
        softwareRendering: typeof info?.auxAttributes?.softwareRendering === "boolean"
          ? info.auxAttributes.softwareRendering : null,
      })).catch(() => ({ status: "unavailable", devices: [] })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout", devices: [] }), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Collect for manual and automatic reports; omit machine IDs and raw GPU dumps. */
async function collectBugReportDeviceInfo({ app, system = os, runtime = process, gpuTimeoutMs = 2000 }) {
  const capturedAt = new Date().toISOString()
  const systemInfo = {
    platform: runtime.platform,
    version: read(() => text(system.version())),
    release: read(() => text(system.release())),
    architecture: read(() => text(system.arch())),
  }
  const cpu = read(() => {
    const cpus = system.cpus()
    return {
      model: text(cpus[0]?.model),
      logicalCores: cpus.length || null,
      speedMHz: cpus[0]?.speed > 0 ? number(cpus[0].speed) : null,
    }
  })
  const memory = read(() => {
    const totalBytes = number(system.totalmem())
    const available = number(system.freemem())
    const freeBytes = available !== null && totalBytes !== null ? Math.min(available, totalBytes) : available
    const usedBytes = totalBytes !== null && freeBytes !== null ? totalBytes - freeBytes : null
    return {
      totalBytes, freeBytes, usedBytes,
      usedPercent: totalBytes > 0 && usedBytes !== null ? Math.round(usedBytes / totalBytes * 1000) / 10 : null,
    }
  })
  const appMemory = read(() => collectAppMemory(app))
  const gpu = await collectGpu(app, gpuTimeoutMs)
  return {
    capturedAt,
    os: systemInfo,
    cpu,
    memory,
    appMemory,
    gpu,
    runtime: {
      electron: text(runtime.versions?.electron),
      chrome: text(runtime.versions?.chrome),
      node: text(runtime.versions?.node),
    },
  }
}

function formatBugReportDeviceInfo(info) {
  if (!info) return "## Device Info\nUnavailable"
  const value = (input) => input ?? "unavailable"
  const gib = (bytes) => bytes === null || bytes === undefined ? "unavailable" : `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  const mib = (bytes) => bytes === null || bytes === undefined ? "unavailable" : `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  const gpuLines = info.gpu.devices.map((gpu, index) =>
    `- GPU ${index + 1}: ${value(gpu.name)}; vendor: ${value(gpu.vendor)}; vendor/device ID: ${value(gpu.vendorId)}/${value(gpu.deviceId)}; active: ${value(gpu.active)}; driver: ${value(gpu.driverVendor)} ${value(gpu.driverVersion)}`)
  return [
    "## Device Info",
    `Captured: ${info.capturedAt}`,
    `- OS: ${value(info.os.version)}; release/build: ${value(info.os.release)}; ${value(info.os.architecture)} (${info.os.platform})`,
    `- CPU: ${value(info.cpu?.model)}; logical cores: ${value(info.cpu?.logicalCores)}; speed: ${value(info.cpu?.speedMHz)} MHz`,
    `- RAM: ${gib(info.memory?.usedBytes)} used / ${gib(info.memory?.totalBytes)} total (${value(info.memory?.usedPercent)}%); ${gib(info.memory?.freeBytes)} free`,
    `- App RAM (Electron processes): ${mib(info.appMemory?.workingSetBytesSum)} working set sum; ${mib(info.appMemory?.privateBytesSum)} private; process count: ${value(info.appMemory?.processCount)}`,
    `- GPU information: ${info.gpu.status}`,
    ...gpuLines,
    `- GPU renderer: ${value(info.gpu.renderer)}; software rendering: ${value(info.gpu.softwareRendering)}`,
    `- Runtime: Electron ${value(info.runtime.electron)}; Chromium ${value(info.runtime.chrome)}; Node ${value(info.runtime.node)}`,
  ].join("\n")
}

module.exports = { collectBugReportDeviceInfo, formatBugReportDeviceInfo }
