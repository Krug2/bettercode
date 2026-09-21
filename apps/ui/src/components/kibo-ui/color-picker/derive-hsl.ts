import Color from "color";

/**
 * Derive HSL slider state from any value the `color` library accepts.
 *
 * Bug history: the picker effect previously did `Color.rgb(value).rgb().object()`
 * and assigned the resulting `r/g/b` channels to the hue/saturation/lightness
 * setters. Channel-count matched so it never crashed; it just rendered the
 * wrong colour whenever the picker was driven by a controlled `value`. This
 * helper converts through `.hsl()` correctly and returns `null` on a malformed
 * value so the caller can short-circuit instead of crashing the boundary.
 */
export function deriveHslState(
  value: Parameters<typeof Color>[0],
): { hue: number; saturation: number; lightness: number; alpha: number } | null {
  let next: { h?: number; s?: number; l?: number; alpha?: number };
  try {
    next = Color(value).hsl().object() as typeof next;
  } catch {
    return null;
  }
  return {
    hue: next.h ?? 0,
    saturation: next.s ?? 0,
    lightness: next.l ?? 0,
    alpha: (next.alpha ?? 1) * 100,
  };
}
