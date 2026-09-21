/**
 * Popover + Command menus restated in SimpleDropdown's chrome, so every menu
 * in the composer row and the chat toolbar reads as one family. Left at their
 * defaults these menus came out visibly foreign — `rounded-3xl` panels with
 * `p-4`, and `text-sm` rows with `px-3 py-2` next to our `text-[11px]` rows
 * with `px-2 py-1`. If SimpleDropdown's look changes, this is the one place
 * to follow it.
 *
 * Radii are concentric: the panel pads by 4px, so its radius is the row
 * radius (`--radius`, 10px) plus 4px. Rows and the search field share the
 * inner radius, which is what makes the inset read as one surface instead
 * of a card with things stuck to its edges.
 */
export const MENU_PANEL = [
  "gap-0 rounded-[calc(var(--radius)+4px)] border border-border/60 bg-popover/95 p-1 ring-0 backdrop-blur-sm",
  // Depth from layered transparent shadows; the border above is structure
  // (popover edge against a same-hue surface), not elevation.
  "shadow-[0_1px_2px_rgba(0,0,0,0.25),0_8px_24px_-12px_rgba(0,0,0,0.6),0_20px_48px_-24px_rgba(0,0,0,0.7)]",
  // The search field ships as a 36px-tall InputGroup, which made the panel
  // top-heavy next to 28px rows. Setting a text size on the inner input alone
  // did nothing — the height lives on the wrapper.
  "[&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=command-input-wrapper]]:pb-1",
  "[&_[data-slot=input-group]]:h-7 [&_[data-slot=input-group]]:rounded-[var(--radius)] [&_[data-slot=input-group]]:border-transparent [&_[data-slot=input-group]]:bg-input/30",
  // Focus is a state, so it needs a static cue: the field brightens while
  // it owns the keyboard (Command autofocuses it, so this is the resting
  // look of an open menu with a search).
  "[&_[data-slot=input-group]]:transition-colors [&_[data-slot=input-group]]:duration-150 [&_[data-slot=input-group]:focus-within]:bg-input/50",
  "[&_[data-slot=command-input]]:placeholder:text-muted-foreground/60",
].join(" ")

export const MENU_ITEM =
  "min-h-7 whitespace-nowrap gap-2 rounded-[var(--radius)] px-2 py-1 text-[11px] font-normal text-popover-foreground transition-colors duration-100 data-selected:bg-accent/50 data-selected:text-foreground [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground data-selected:[&>svg]:text-foreground"

/** Second line under a row label: what the choice implies, never a repeat of it. */
export const MENU_ITEM_HINT =
  "mt-0.5 block truncate text-[10px] font-normal text-muted-foreground/70"

/** Group headings on SimpleDropdownLabel's scale; list padding is the panel's. */
export const MENU_LIST =
  "p-0 **:[[cmdk-group]]:p-0 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-1.5 **:[[cmdk-group-heading]]:pb-0.5 **:[[cmdk-group-heading]]:text-[9px] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:uppercase"

export const MENU_INPUT = "text-[11px]"

export const MENU_SEPARATOR = "my-1 h-px bg-border/40"

/** Standalone heading for menus that are not a Command list (same scale). */
export const MENU_HEADING =
  "px-2 pt-1.5 pb-0.5 text-[9px] font-medium tracking-wider text-muted-foreground uppercase first:pt-0.5"

/**
 * A non-interactive note at the foot of a menu: a statement about the
 * product, not an option. Smaller than a row, no reserved icon column and no
 * hover, so it cannot be mistaken for a disabled choice.
 */
export const MENU_NOTE =
  "mt-1 flex select-none items-center gap-1.5 border-t border-border/40 px-2 pt-1.5 pb-0.5 text-[10px] leading-4 text-muted-foreground/55 [&>svg]:size-3 [&>svg]:shrink-0"

/** Panel widths: two sizes, not one per menu. */
export const MENU_WIDTH_SM = "w-[224px]"
export const MENU_WIDTH_MD = "w-[256px]"

/** MENU_ITEM for a plain button in a menu that is not a Command list. */
export const MENU_BUTTON =
  "flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-left text-[11px] font-normal text-popover-foreground transition-colors duration-100 hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground hover:[&>svg]:text-foreground"
