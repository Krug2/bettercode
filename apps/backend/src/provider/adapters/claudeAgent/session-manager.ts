import { logger } from "../../../observability/logger";
import type { SdkModule } from "./sdk-types";

/**
 * Module-level cache of the dynamically-imported SDK. The SDK is in the repo
 * root's node_modules; we resolve it lazily on first use so backend startup
 * isn't blocked on SDK initialisation for users who never speak to Claude.
 */
let sdkModuleCache: SdkModule | null = null;

export async function loadClaudeSdk(): Promise<SdkModule | null> {
  if (sdkModuleCache) return sdkModuleCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("@anthropic-ai/claude-agent-sdk" as any)) as SdkModule;
    sdkModuleCache = mod;
    return mod;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to load @anthropic-ai/claude-agent-sdk");
    return null;
  }
}
