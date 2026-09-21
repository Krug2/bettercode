import type { ProviderAdapter } from "./adapter";
import type { ProviderKind } from "./types";

/** In-memory registry — mirrors rust-backend/src/provider/registry.rs. */
export class ProviderAdapterRegistry {
  private readonly byKind = new Map<ProviderKind, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.byKind.set(adapter.providerKind(), adapter);
  }

  get(kind: ProviderKind): ProviderAdapter | null {
    return this.byKind.get(kind) ?? null;
  }

  all(): ProviderAdapter[] {
    return Array.from(this.byKind.values());
  }

  /** Interrupt every in-flight turn across all registered adapters. Returns
   *  the total number of turns that were interrupted. */
  async interruptAll(): Promise<number> {
    const results = await Promise.allSettled(
      Array.from(this.byKind.values(), (adapter) => Promise.resolve().then(() => adapter.interruptAll())),
    );
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Failed to interrupt all provider adapters");
    return results.reduce((total, result) => total + (result.status === "fulfilled" ? result.value : 0), 0);
  }
}
