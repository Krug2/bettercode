"use strict"

/**
 * electron-builder `afterSign` hook — conditional macOS notarization.
 *
 * Runs automatically after the app bundle is code-signed. Notarizes the
 * signed .app with Apple's notary service so Gatekeeper stops warning users.
 *
 * Activation contract (ALL must be true):
 *   - Platform is darwin
 *   - `APPLE_ID` env var is set (Apple developer account email)
 *   - `APPLE_APP_SPECIFIC_PASSWORD` env var is set (app-specific password
 *     from https://appleid.apple.com/account/manage → Sign-In and Security)
 *   - `APPLE_TEAM_ID` env var is set (10-char team id from Apple Developer)
 *   - `@electron/notarize` is installed
 *
 * If any of those are missing we log and skip — dev builds, CI runs without
 * Apple secrets, and first-time contributors all continue to work without
 * needing Apple credentials.  Windows/Linux builds also short-circuit here
 * because `afterSign` is invoked on every platform.
 */

module.exports = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context

  if (electronPlatformName !== "darwin") return

  const appleId = process.env.APPLE_ID
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !applePassword || !teamId) {
    console.log(
      "[notarize] skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set"
    )
    return
  }

  let notarize
  try {
    ;({ notarize } = require("@electron/notarize"))
  } catch (err) {
    console.warn(
      "[notarize] @electron/notarize is not installed — skipping.  Run `npm install` with the devDependency present to enable notarization."
    )
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[notarize] submitting ${appPath} to Apple notary service...`)
  try {
    await notarize({
      tool: "notarytool",
      appPath,
      appleId,
      appleIdPassword: applePassword,
      teamId,
    })
    console.log("[notarize] success")
  } catch (err) {
    console.error(
      "[notarize] failed:",
      err && err.message ? err.message : err
    )
    // Re-throw so the build fails loudly rather than shipping an
    // unnotarized build when credentials WERE present (config drift would
    // otherwise silently produce broken artifacts).
    throw err
  }
}
