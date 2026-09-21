"use strict";

if (process.platform !== "darwin") {
  console.error(
    "[require-mac] build:mac:signed only runs on macOS — codesign + xcrun stapler are macOS-only tools.",
  );
  process.exit(1);
}
