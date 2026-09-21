import { describe, it, expect } from "vitest";
import { deriveHslState } from "./derive-hsl";

describe("deriveHslState", () => {
  it("returns the correct HSL channels for primary red", () => {
    const got = deriveHslState("#ff0000");
    expect(got).not.toBeNull();
    expect(got!.hue).toBe(0);
    expect(got!.saturation).toBe(100);
    expect(got!.lightness).toBe(50);
    expect(got!.alpha).toBe(100);
  });

  it("returns the correct HSL channels for primary green", () => {
    const got = deriveHslState("#00ff00");
    expect(got!.hue).toBe(120);
    expect(got!.saturation).toBe(100);
    expect(got!.lightness).toBe(50);
  });

  it("returns the correct HSL channels for primary blue", () => {
    const got = deriveHslState("#0000ff");
    expect(got!.hue).toBe(240);
    expect(got!.saturation).toBe(100);
    expect(got!.lightness).toBe(50);
  });

  // Bug regression: previous implementation read RGB channels into the HSL
  // setters, so #ff0000 produced (255, 0, 0) instead of (0, 100, 50). Lock
  // that behaviour out forever.
  it("does NOT return (255, 0, 0) for red — that's the legacy RGB-into-HSL bug", () => {
    const got = deriveHslState("#ff0000");
    expect(got!.hue).not.toBe(255);
    expect(got!.saturation).not.toBe(0);
  });

  it("scales alpha 0..1 → 0..100 for the slider", () => {
    expect(deriveHslState("rgba(255, 0, 0, 0.5)")!.alpha).toBe(50);
    expect(deriveHslState("rgba(255, 0, 0, 0)")!.alpha).toBe(0);
    expect(deriveHslState("rgba(255, 0, 0, 1)")!.alpha).toBe(100);
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(deriveHslState("not-a-color")).toBeNull();
    // `null`/`undefined` go through `Color()` and may behave specially; the
    // important property is that no exception escapes the helper.
    expect(() => deriveHslState("###")).not.toThrow();
  });
});
