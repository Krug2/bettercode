import DOMPurify from "dompurify"

// [SECURITY] Centralized SVG sanitizer. Mermaid output is rendered via
// dangerouslySetInnerHTML, and the prior regex-based sanitizer failed to strip:
//   - xlink:href="javascript:..."
//   - <animate to="javascript:...">
//   - CSS url("javascript:...") in inline style attributes
//   - <use href="javascript:..."/>
// DOMPurify's svg profile handles all of the above. Keep every future SVG/HTML
// sanitization going through this file so there is one bypass surface to audit.
//
// [SECURITY] `<style>` is NOT allowed, and this is deliberate.
//
// It used to be re-enabled via ADD_TAGS, justified by the claim that DOMPurify
// sanitizes stylesheet bodies with a "built-in CSS parser". That is not true —
// DOMPurify filters *attributes* against IS_ALLOWED_URI and does not inspect
// the contents of a <style> element. And a <style> inside inline SVG in an HTML
// document is not scoped to the SVG: it applies to the whole document. Mermaid
// source is model output, so allowing it handed model-controlled CSS global
// authority over the app's own chrome — including the ability to hide, move, or
// cover the tool-approval dialog and its Approve/Deny buttons. CSS cannot run
// script, but restyling the primary safety boundary is enough on its own.
//
// [RENDERING] Losing mermaid's inline <style> costs nothing here: the theme is
// already supplied twice over — `mermaid.initialize({ themeVariables })` bakes
// the palette into presentation attributes, and `.mermaid-diagram-host` in
// index.css scopes the text-fill override that keeps labels legible. The `style`
// *attribute* stays allowed for per-element fills; unlike the element it cannot
// select anything outside the node it sits on.
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_ATTR: ["style"],
    FORBID_TAGS: ["style", "script", "foreignObject"],
  }) as unknown as string
}
