import { z } from "zod"

export const designTargetSchema = z.enum([
  "website",
  "mobile-app",
  "website-mobile",
  "desktop-app",
  "dashboard",
])
export type DesignTarget = z.infer<typeof designTargetSchema>

export const designColorModeSchema = z.enum(["light", "dark", "mixed"])
export type DesignColorMode = z.infer<typeof designColorModeSchema>

export const designStyleTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  direction: z.string().default(""),
  prompt: z.string().default(""),
})
export type DesignStyleTemplate = z.infer<typeof designStyleTemplateSchema>

export const designFontPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().default("sans"),
  stack: z.string().default(""),
  guidance: z.string().default(""),
})
export type DesignFontPreset = z.infer<typeof designFontPresetSchema>

export const designComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
})
export type DesignComponent = z.infer<typeof designComponentSchema>

export const designComponentLibrarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  components: z.array(designComponentSchema).default([]),
})
export type DesignComponentLibrary = z.infer<
  typeof designComponentLibrarySchema
>

export const designComponentImportSchema = z.object({
  libraryId: z.string().min(1),
  componentId: z.string().min(1),
  name: z.string().min(1),
})
export type DesignComponentImport = z.infer<typeof designComponentImportSchema>

export const customStyleReferencesSchema = z.object({
  websiteLinks: z.array(z.string()).default([]),
  imageFiles: z.array(z.string()).default([]),
  htmlFiles: z.array(z.string()).default([]),
  notes: z.string().default(""),
})
export type CustomStyleReferences = z.infer<typeof customStyleReferencesSchema>

export const designBriefSchema = z.object({
  target: designTargetSchema,
  colorMode: designColorModeSchema,
  styleTemplateId: z.string().nullable().default(null),
  customStyleReferences: customStyleReferencesSchema.default({
    websiteLinks: [],
    imageFiles: [],
    htmlFiles: [],
    notes: "",
  }),
  fontPresetId: z.string().nullable().default(null),
  customFont: z.string().default(""),
  componentImports: z.array(designComponentImportSchema).default([]),
  description: z.string().default(""),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
})
export type DesignBrief = z.infer<typeof designBriefSchema>

export const DESIGN_STYLE_TEMPLATES: DesignStyleTemplate[] = [
  {
    id: "minimal-saas",
    name: "Minimal SaaS",
    description:
      "Quiet software polish, strong hierarchy, restrained surfaces.",
    direction:
      "Use lean sections, crisp typography, low-contrast borders, and practical conversion flow.",
    prompt: [
      "Art direction: quiet, precise software company — the confidence is in the restraint (reference class: Linear, Vercel, Stripe).",
      "Palette: near-white base (or near-black in dark mode) with a slightly cool neutral ramp; ONE accent used almost exclusively for the primary CTA and interactive highlights. No gradient larger than a 2–3% surface wash.",
      "Type: a crisp grotesque; headings medium/semibold (never black weight) with -0.02em tracking at display sizes; body 15–16px at 1.6 line-height. Hierarchy through size steps and muted-vs-primary text color, not decoration.",
      "Surfaces: 1px hairline borders (6–10% alpha) instead of shadows; radii 6–10px from one family; elevation used at most twice per screen.",
      "Layout: generous page whitespace, compact component interiors; features demonstrated with real product-UI panels or screenshots, not abstract illustration.",
      "Motion: 120–180ms ease-out micro-transitions on hover/focus only; nothing autoplays or floats.",
      "Don't: decorative blobs, glassmorphism, multi-stop color gradients, oversized rounded cards with heavy shadows, exclamation-point marketing copy.",
    ].join("\n"),
  },
  {
    id: "premium-dark-agency",
    name: "Premium Dark Agency",
    description: "Dark editorial agency language with confident composition.",
    direction:
      "Use off-black surfaces, asymmetric layouts, precise motion, and one controlled accent.",
    prompt: [
      "Art direction: high-end creative studio in dark editorial mode — cinematic, typographic, unhurried (reference class: awards-level agency portfolios).",
      "Palette: committed off-black base (#0B0B0C–#111111, warm or cool but decisive); ~90% of every view is monochrome; ONE accent (signal orange, acid green, or warm ivory) on under 5% of the surface — links, hover underlines, one highlighted word.",
      "Type: display serif or expressive grotesque at extreme scale for statements (up to 7–9rem on desktop via clamp(), line-height 0.95–1.05, tracking -0.02 to -0.04em) paired with a small quiet body face at 15–16px in 55–65% white. Type IS the imagery.",
      "Layout: asymmetric editorial grid — offset columns, staggered project rows, oversized index numerals (01, 02) as navigation devices; full-bleed imagery with generous negative space; never three equal cards in a row.",
      "Texture: subtle film grain or vignette allowed; no neon glows, no glass panels.",
      "Motion: few and deliberate — 300–500ms ease-out reveal-on-scroll (translate + opacity), a line-mask reveal on the hero only; honor reduced-motion.",
      "Don't: purple/blue gradients, glowing borders, centered-symmetric everything, stock-photo people grids, a second accent color.",
    ].join("\n"),
  },
  {
    id: "editorial-magazine",
    name: "Editorial Magazine",
    description: "Large type, image-led rhythm, and print-inspired spacing.",
    direction:
      "Use magazine pacing, bold type contrast, and generous white space without generic cards.",
    prompt: [
      "Art direction: contemporary print magazine translated to the web — feature-story energy, image-led, unmistakably editorial (reference class: culture publications and long-form feature pages).",
      "Palette: paper tones — warm white or cream base, near-black ink text, ONE editorial accent (oxblood, cobalt, or mustard) for rules, links, and kickers.",
      "Type: serif/sans pairing with real contrast — display serif headlines at 48–96px with tight 1.0–1.1 leading; text face at 17–19px, 1.6–1.7 line-height, strict 55–70ch measure; kickers and bylines as 11–12px uppercase overlines with wide tracking.",
      "Layout: column grids with intentional asymmetry; pull quotes that break the column; full-bleed images with captions and credits; hairline rules as separators; a drop cap at most once per page.",
      "Imagery: large, art-directed photography or illustration — never icon-decorated feature cards.",
      "Motion: nearly none; subtle image reveals at most — reading is the experience.",
      "Don't: card grids for articles, centered hero sections, generic SaaS patterns, boxed shadows, truncated teaser text everywhere.",
    ].join("\n"),
  },
  {
    id: "clean-fintech",
    name: "Clean Fintech",
    description: "Trustworthy, analytical, conversion-aware financial UI.",
    direction:
      "Use calm density, exact data hierarchy, security cues, and polished product surfaces.",
    prompt: [
      "Art direction: credible financial software — calm, exact, quietly confident; trust is built through precision, not badges (reference class: modern fintech product sites and banking dashboards).",
      "Palette: cool neutral ramp on near-white (or deep navy-charcoal in dark mode); ONE disciplined accent (deep green, navy, or restrained blue) for primary actions; semantic green/red reserved strictly for financial deltas, never decoration.",
      "Type: neutral grotesque; body 14–16px; ALL numbers in tabular-nums, right-aligned in tables, consistent decimal precision; currency and percentage formatting exact.",
      "Layout: airy marketing sections but dense, grid-exact product surfaces; data tables and charts as first-class design objects — low-alpha gridlines, labeled axes, no rainbow palettes; account/balance cards with a single level of elevation.",
      "Trust cues: security and compliance mentions placed near actions only when derivable from the project description — never invent certifications.",
      "Motion: minimal, 120–200ms; a number may count up or transition subtly, once.",
      "Don't: crypto-neon gradients, glowing charts, playful illustration in transactional flows, fake data badges, decorative padlocks.",
    ].join("\n"),
  },
  {
    id: "luxury-product",
    name: "Luxury Product",
    description: "Premium product storytelling with restrained drama.",
    direction:
      "Use high-quality product framing, careful whitespace, refined contrast, and tactile CTAs.",
    prompt: [
      "Art direction: quiet luxury — the product is the hero, everything else recedes; museum-grade restraint (reference class: high-end fashion, watches, audio, and flagship hardware pages).",
      "Palette: warm neutrals — ivory, bone, charcoal, espresso — with at most one metallic-adjacent accent (brass, champagne) used as a whisper; near-zero saturated color.",
      "Type: refined pairing — a light-to-regular weight display face (serif or precise grotesque) plus wide uppercase 10–12px letter-spaced eyebrow labels; body small and unhurried at 1.7 line-height; prices and materials typeset with care.",
      "Layout: extreme whitespace — sections may be 60% empty; one product focus per viewport; large photography full-bleed or on seamless backgrounds; specifications as elegant key-value tables with hairline rules.",
      "Imagery: photography carries the page — moody lighting, texture close-ups; no clip-art, no busy lifestyle collages.",
      "Motion: slow and weighted — 400–700ms ease-out fades, parallax under 8px; one choreographed reveal per section maximum.",
      "Don't: discount badges, urgency banners, bright CTA buttons, drop shadows on product shots, cluttered feature grids, exclamation marks.",
    ].join("\n"),
  },
  {
    id: "startup-landing",
    name: "Startup Landing",
    description: "Sharp startup story with clear offer and fast scanning.",
    direction:
      "Use strong value framing, compact proof, modern sections, and efficient onboarding flow.",
    prompt: [
      "Art direction: sharp, credible early-stage product story — clarity over cleverness, momentum without hype (reference class: well-executed developer-tool and B2B product launches).",
      "Palette: neutral base with ONE energetic but calibrated accent; optional soft tinted section backgrounds (2–4% of the accent) to pace the scroll.",
      "Type: modern grotesque; hero headline states what the product does for whom in plain words at 44–72px semibold; subhead 18–20px muted; body 16px.",
      "Layout: proven narrative spine — nav, hero with a real product screenshot, social-proof strip (only names derivable from the description), 2–3 alternating feature sections with real UI imagery, one how-it-works or metrics moment, pricing if described, final CTA band, compact footer. Vary section composition; no three-card-grid repetition.",
      "Proof: concrete numbers and specifics from the description; placeholder logos labeled as placeholders.",
      "Motion: 150–250ms entrance staggers on scroll, once per section; no floating mockups.",
      "Don't: buzzword headlines (\"Supercharge your workflow\"), fake testimonials, gradient mesh backgrounds, emoji bullets, ten interchangeable sections.",
    ].join("\n"),
  },
  {
    id: "mobile-app-storefront",
    name: "Mobile App Storefront",
    description:
      "App launch page with device-forward visuals and feature rhythm.",
    direction:
      "Use phone-first screenshots, feature strips, onboarding states, and platform-aware details.",
    prompt: [
      "Art direction: app launch page built around the product in-hand — device-forward, feature-rhythmic, conversion-aware (reference class: polished consumer app marketing sites).",
      "Palette: clean base matching the app's own UI temperature; ONE accent shared with the app brand; soft tinted panels to frame device shots.",
      "Type: friendly product sans; hero 40–64px; feature titles 24–32px; store badges and platform copy typeset exactly (official badge proportions, never approximations).",
      "Layout: hero with a device mockup showing a REAL screen of the app (derived from the description — not lorem UI); alternating feature strips with text beside device crops; a screens gallery moment; ratings/downloads only when real numbers are derivable; closing CTA with both store badges.",
      "Device frames: current-generation, neutral color, consistent scale and shadow treatment across every instance.",
      "Motion: gentle screen-content parallax inside static frames, 200–300ms section reveals; no spinning devices.",
      "Don't: fake star ratings, invented download counts, tilted 3D device collages, feature icons replacing actual screenshots, QR codes unless requested.",
    ].join("\n"),
  },
  {
    id: "dashboard-pro",
    name: "Dashboard Pro",
    description: "Dense operational UI for repeated daily work.",
    direction:
      "Use compact navigation, table-first hierarchy, stable controls, and low-noise panels.",
    prompt: [
      "Art direction: professional operational software for daily repeated use — density with calm, zero marketing energy inside the app frame (reference class: best-in-class admin consoles and internal tools).",
      "Palette: restrained neutrals (light: near-white layers; dark: stepped graphite surfaces); ONE interactive accent; status colors (green/amber/red/blue) reserved exclusively for state, applied to dots, chips, and text — never whole panels.",
      "Type: UI sans at 13–14px base, 12px secondary, 11px uppercase +0.05em group labels; page titles 18–20px semibold maximum; all data in tabular-nums.",
      "Layout: fixed sidebar (grouped nav, clear active state) plus a consistent page header (title, context, primary action, filters); tables as the core surface — 36–44px rows, right-aligned numerics, sticky headers, hover states; stat cards with a 24–32px value over a 12px muted label, trend shown by icon direction plus color; every table and panel gets designed empty, loading (skeleton), and error states.",
      "Motion: functional only — 100–150ms; no entrance choreography.",
      "Don't: hero sections in-app, oversized padding, decorative illustration in workflows, rainbow chart defaults, card-in-card-in-card nesting, more than two elevation levels.",
    ].join("\n"),
  },
  {
    id: "brutalist-tech",
    name: "Brutalist Tech",
    description: "Mechanical, direct, grid-heavy technical identity.",
    direction:
      "Use rigid grids, strong dividers, direct labels, and minimal decoration.",
    prompt: [
      "Art direction: raw, engineered, typographic — the grid is visible and proud, decoration is deleted (reference class: Swiss/Berlin studio sites and unapologetic developer-brand pages).",
      "Palette: strict monochrome — paper white and ink black (or inverted); ONE optional harsh accent (signal red, safety orange, or electric blue) for links and active states only.",
      "Type: mono or grotesque everywhere; huge headlines 60–120px in 700–900 weight with neutral tracking; body compact 14–16px; uppercase labels with visible logic (INDEX, 01, →).",
      "Structure: exposed grid — 1–2px solid rules and full-width dividers do all separation; radii 0; NO shadows, NO gradients; tables and lists rendered as actual ruled tables; hover states invert (black↔white) or underline hard.",
      "Texture: none, or a barely-there paper grain; whitespace is deliberate and uneven — asymmetry over balance.",
      "Motion: instant or stepped (0–100ms, linear); one marquee or cursor-follow allowed if it serves the identity.",
      "Don't: rounded corners, soft shadows, pastel colors, glassmorphism, smooth 300ms ease-in-out on everything, centered symmetric layouts, friendly rounded icons.",
    ].join("\n"),
  },
  {
    id: "warm-creator",
    name: "Warm Creator",
    description: "Personal, creator-led product language with warm contrast.",
    direction:
      "Use human pacing, soft neutral contrast, clear community cues, and approachable CTAs.",
    prompt: [
      "Art direction: personal, human, crafted — a person's corner of the internet, not a company (reference class: beloved writer, designer, and creator personal sites).",
      "Palette: warm paper tones — cream, oat, warm gray — with ink-brown or soft-black text and ONE warm accent (terracotta, moss, marigold); nothing fluorescent.",
      "Type: characterful pairing — a serif with personality for headlines (32–56px) and a comfortable reading face at 17–19px, 1.65–1.75 line-height, 60–70ch measure; occasional italic for voice; no uppercase shouting.",
      "Layout: single-column reading spine with breathing room; content first — writing, work, or projects before any pitch; a personal photo or analog touch used once or twice with intention; community CTAs phrased personally and only with real derivable numbers.",
      "Texture: subtle paper grain, soft duotone photo treatment, or hand-underline accents — pick at most one motif and repeat it consistently.",
      "Motion: gentle 200–300ms fades; nothing bouncy.",
      "Don't: corporate SaaS patterns, cold blue-gray neutrals, stock photography, three-column feature grids, growth-hacking urgency, emoji strings.",
    ].join("\n"),
  },
  {
    id: "ecommerce-conversion",
    name: "Ecommerce Conversion",
    description: "Product browsing, selection, and checkout clarity.",
    direction:
      "Use product-first media, clear price/action hierarchy, filters, trust, and availability states.",
    prompt: [
      "Art direction: focused commerce — the product photography sells, the interface removes friction (reference class: high-converting DTC storefronts with editorial polish).",
      "Palette: neutral chrome that defers to product imagery; ONE accent for add-to-cart and checkout actions only; semantic colors for stock and shipping states.",
      "Type: clean sans; product names 16–18px medium; prices always visible at 16–20px semibold with honest sale logic (old price struck through); shipping/returns microcopy at 12–13px near the action.",
      "Layout: product-first grids — consistent aspect ratios, generous image area, minimal card chrome (image, name, price, at most one badge); product pages with a sticky buy box (price, variants as buttons where feasible, clear stock state, one primary CTA); filters and sort as accessible chips or a proper drawer; trust signals near checkout actions, understated.",
      "Imagery: uniform photography treatment across the catalog; lifestyle and solo-product mix.",
      "Motion: quick and functional — 120–200ms; hover swaps to an alternate product shot; no carousel autoplay.",
      "Don't: fake countdown timers, invented reviews, stacked promo popups, badges cluttering every card, mystery \"SALE\" theatrics.",
    ].join("\n"),
  },
  {
    id: "neon-cyber",
    name: "Neon Cyber",
    description:
      "High-contrast technical UI with controlled futuristic accents.",
    direction:
      "Use a restrained cyber palette, sharp grids, atmospheric depth, and readable controls.",
    prompt: [
      "Art direction: engineered, terminal-adjacent futurism — restrained cyber, not vaporwave (reference class: security and devtool brands with HUD influence).",
      "Palette: deep blue-black or graphite base (#05070A–#0D1117); cool neutrals; ONE electric accent (cyan, lime, or magenta — pick one) plus a desaturated support tone. Neon appears as thin rules, text highlights, and small glows (blur ≤ 12px, low alpha) — never as full-surface gradients or glowing borders on every card.",
      "Type: technical grotesque; monospace ONLY for data, labels, coordinates and code (11–13px, +0.05em tracking, uppercase overlines); headings sharp and tight, no italics.",
      "Structure: visible grid — hairline rules and 1px dividers at 8–12% alpha, cornered or notched containers, radii 0–4px; optional scanline or grid texture at ≤ 3% opacity.",
      "Data aesthetics: status chips, version strings, uptime-style micro-stats as decoration only when derivable from real content — never invented dashboards of random numbers.",
      "Motion: fast and mechanical (100–160ms, linear or ease-in-out), a stepped or cursor-blink reveal used once or twice; no floaty parallax.",
      "Don't: rainbow neon, purple-pink synthwave gradients, glass cards, glow on body text — body copy stays ≥ 4.5:1 contrast, readability first.",
    ].join("\n"),
  },
]

export const DESIGN_FONT_PRESETS: DesignFontPreset[] = [
  {
    id: "geist",
    name: "Geist",
    category: "technical sans",
    stack: "Geist, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Weights: 400 body, 500 UI labels, 600 headings; tracking -0.01 to -0.02em above 24px. Source: Google Fonts, or the `geist` npm package in Next.js (import { GeistSans } from 'geist/font/sans'). Pair with Geist Mono for code and data.",
  },
  {
    id: "inter",
    name: "Inter",
    category: "neutral sans",
    stack: "Inter, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Workhorse UI neutral: 400/500/600; enable font-feature-settings 'cv11' and tabular-nums for data. Inter-everywhere is a generic-AI tell — use it for UI text and pick a distinct display face if the brief allows. Google Fonts; use next/font in Next.js.",
  },
  {
    id: "montserrat",
    name: "Montserrat",
    category: "geometric sans",
    stack: "Montserrat, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Best as a geometric display voice: 600/700 headings with slightly tightened tracking at large sizes; its light weights read weak in long body text — pair with a neutral body sans at 15–16px. Google Fonts; load only the weights used.",
  },
  {
    id: "poppins",
    name: "Poppins",
    category: "rounded sans",
    stack: "Poppins, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Rounded geometric with a big x-height: 500/600 for headings and buttons, 400 body at 15–16px with 1.6+ line-height; avoid 300 for paragraphs. Friendly consumer tone — keep tracking at 0, never uppercase-wide. Google Fonts.",
  },
  {
    id: "manrope",
    name: "Manrope",
    category: "modern sans",
    stack: "Manrope, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Modern semi-condensed sans, variable 200–800: 400 body, 500/700 headings with -0.01em tracking; strong for product UI and marketing alike. Google Fonts (variable); subset to latin unless the copy needs more.",
  },
  {
    id: "satoshi",
    name: "Satoshi",
    category: "premium sans",
    stack: "Satoshi, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Weights 500/700 for headings, 400 body; neutral-warm with a slight geometric edge. NOT on Google Fonts — load from Fontshare (free) via their CDN link or self-host @font-face with font-display: swap.",
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    category: "display sans",
    stack: "Space Grotesk, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Display-first grotesque with quirky details: 500/700 for headlines and numerals, tracking -0.01 to -0.03em; keep body text in a quieter sans — Space Grotesk paragraphs tire quickly. Google Fonts. Natural fit for technical directions.",
  },
  {
    id: "plus-jakarta-sans",
    name: "Plus Jakarta Sans",
    category: "product sans",
    stack: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Balanced product sans: 400 body, 500 UI, 600–700 headings; slightly geometric warmth that works for marketing and app surfaces alike. Google Fonts (variable available); enable tabular-nums in data tables.",
  },
  {
    id: "dm-sans",
    name: "DM Sans",
    category: "clean sans",
    stack: "DM Sans, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Clean low-contrast sans with an optical-size axis: 400 body (works small), 500 UI, 700 headings; tracking 0 to -0.01em. Google Fonts (variable). Quietly neutral — a good body partner for a serif or display face.",
  },
  {
    id: "outfit",
    name: "Outfit",
    category: "geometric sans",
    stack: "Outfit, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Geometric display sans: 500–700 for headings with -0.01em tracking; body acceptable at 400/16px but watch long-form readability — consider a humanist body partner. Google Fonts (variable).",
  },
  {
    id: "ibm-plex-sans",
    name: "IBM Plex Sans",
    category: "technical sans",
    stack: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
    guidance:
      "Engineered corporate voice: 400 body, 500 UI, 600 headings; pairs natively with IBM Plex Mono for code and data — use the pair for technical products. Google Fonts; keep tracking neutral, it is already precise.",
  },
  {
    id: "playfair-display",
    name: "Playfair Display",
    category: "editorial serif",
    stack: "Playfair Display, Georgia, serif",
    guidance:
      "Display-only serif: headlines and pull quotes at 32px+, weights 500–700, line-height 1.1–1.2; its high stroke contrast collapses at small sizes — never body or UI controls. Pair with a neutral sans at 15–16px. Google Fonts; use next/font in Next.js.",
  },
]

export const designDefaultsSchema = z.object({
  styleTemplates: z
    .array(designStyleTemplateSchema)
    .default(DESIGN_STYLE_TEMPLATES),
  fontPresets: z.array(designFontPresetSchema).default(DESIGN_FONT_PRESETS),
  componentLibraries: z.array(designComponentLibrarySchema).default([]),
})
export type DesignDefaults = z.infer<typeof designDefaultsSchema>

export const DEFAULT_DESIGN_DEFAULTS: DesignDefaults = {
  styleTemplates: DESIGN_STYLE_TEMPLATES,
  fontPresets: DESIGN_FONT_PRESETS,
  componentLibraries: [],
}
