import { Config } from "@remotion/cli/config"
import path from "path"
import webpack from "webpack"

// Remotion auto-transpiles this config to CJS, so the Node `require`
// global is already available for loader resolution below.

Config.setVideoImageFormat("jpeg")
Config.setConcurrency(4)
Config.setCodec("h264")
// Serve the real app's public/ folder — contains favicon.svg, sounds/mechvibes/**,
// file-icons/, and other assets the app requests at runtime.
Config.setPublicDir("./apps/ui/public")

/**
 * Override webpack so Remotion can resolve `@/…` paths and redirect
 * `@/lib/transport` to the demo-mode stub. This keeps the real app
 * components untouched — they still call readFile/gitDiff/etc., but
 * those calls now hit in-memory mocks instead of the Electron sidecar IPC.
 */
Config.overrideWebpackConfig((config) => {
  const root = process.cwd()
  return {
    ...config,
    resolve: {
      ...config.resolve,
      // css-loader resolves the renderer's /file-icons/... public URLs here.
      roots: [path.resolve(root, "apps/ui/public"), ...(config.resolve?.roots ?? [])],
      // Shared source contracts use Node-style .js specifiers for their .ts files.
      extensionAlias: {
        ...config.resolve?.extensionAlias,
        ".js": [".js", ".ts", ".tsx"],
      },
      alias: {
        ...(config.resolve?.alias ?? {}),
        // `@/lib/transport` MUST resolve to our stub before the generic
        // `@` alias gets a chance, hence the `$` exact-match suffix.
        "@/lib/transport$": path.resolve(root, "remotion/mocks/transport.ts"),
        // Remotion's default webpack config doesn't declare `@`, so our
        // addition wins and BetterC0de's `@/…` imports resolve to the UI workspace.
        "@": path.resolve(root, "apps/ui/src"),
      },
      extensions: [
        ...(config.resolve?.extensions ?? []),
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
      ],
    },
    module: {
      ...config.module,
      // Drop any pre-existing .css rule so our Tailwind-PostCSS pipeline
      // wins. Then prepend our rule.
      rules: [
        {
          test: /\.css$/i,
          use: [
            { loader: require.resolve("style-loader") },
            {
              loader: require.resolve("css-loader"),
              options: { importLoaders: 1 },
            },
            {
              loader: require.resolve("postcss-loader"),
              options: {
                postcssOptions: {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  plugins: [require("@tailwindcss/postcss")()],
                },
              },
            },
          ],
        },
        ...(config.module?.rules ?? []).filter(
          (rule): rule is NonNullable<typeof rule> => {
            if (!rule || typeof rule !== "object") return false
            const test = (rule as { test?: unknown }).test
            // Keep all non-CSS rules; drop anything that would otherwise
            // also match `.css` (string, RegExp, or function).
            if (test instanceof RegExp) {
              return !test.test("x.css")
            }
            return true
          }
        ),
      ],
    },
    plugins: [
      ...(config.plugins ?? []),
      // The app relies on the automatic JSX runtime — ProvidePlugin is a
      // belt-and-suspenders so any stray `React.xxx` reference in bundled
      // code still resolves even if the automatic transform misses it.
      new webpack.ProvidePlugin({ React: "react" }),
      // Remotion copies `public/` → `{bundle}/public/` and serves it at
      // `/public/*`. The app's `assetUrl()` reads BASE_URL from
      // `import.meta.env`, which defaults to "/". That would build
      // `/favicon.svg` → 404. Inject `/public/` so assetUrl() produces
      // `/public/favicon.svg`, matching Remotion's actual static hash.
      new webpack.DefinePlugin({
        "import.meta.env.BASE_URL": JSON.stringify("/public/"),
      }),
    ],
  }
})
