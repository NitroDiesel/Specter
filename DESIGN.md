---
name: Specter
description: Chromatic Registration for private browser-state control.
colors:
  proof-stock: "#f4f6f5"
  proof-raised: "#ffffff"
  proof-muted: "#e7ebeb"
  proof-deep: "#dce2e2"
  registration-ink: "#17191d"
  soft-ink: "#50575c"
  faint-ink: "#5f676c"
  proof-line: "#c5cccd"
  proof-line-strong: "#727b7e"
  control-teal: "#007c91"
  control-teal-deep: "#005d6c"
  control-teal-wash: "#d9f1f4"
  focus-on-dark: "#5ad5e8"
  process-cyan: "#00a9c7"
  process-magenta: "#e13d7e"
  process-yellow: "#f2c84b"
  registered-green: "#00785f"
  registered-mint: "#5dd1ad"
  fault-red: "#b43d43"
  night-proof: "#111518"
  night-raised: "#191f23"
  night-ink: "#f2f5f3"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.125rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.6875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Ubuntu, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  action:
    fontFamily: "Ubuntu, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.5
  navigation:
    fontFamily: "Ubuntu, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.5
  data:
    fontFamily: "Ubuntu Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.03em"
rounded:
  index: "3px"
  control: "4px"
  transient: "6px"
  panel: "10px"
spacing:
  compact: "8px"
  control: "12px"
  group: "16px"
  section: "32px"
  canvas: "54px"
components:
  button-primary:
    backgroundColor: "{colors.control-teal}"
    textColor: "{colors.proof-raised}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.proof-raised}"
    textColor: "{colors.registration-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
    height: "40px"
  field:
    backgroundColor: "{colors.proof-raised}"
    textColor: "{colors.registration-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
    height: "42px"
  protection-switch:
    backgroundColor: "{colors.registration-ink}"
    textColor: "{colors.proof-raised}"
    rounded: "{rounded.control}"
    width: "64px"
    height: "32px"
  navigation-active:
    backgroundColor: "{colors.registration-ink}"
    textColor: "{colors.proof-stock}"
    typography: "{typography.navigation}"
    rounded: "{rounded.index}"
    padding: "7px 10px"
    height: "44px"
---

# Design System: Specter

## Overview

**Creative North Star: "Chromatic Registration"**

Specter is a browser-state proofing instrument. Cool proof stock, precise black rules, crop marks, registration targets, and process cyan, magenta, and yellow turn protection into something users can verify rather than merely trust. The visual world is technical and exact without borrowing terminal or hacker-console theater.

The signature behavior is registration: the three process layers begin visibly offset and snap into alignment when protection is active. The popup compresses Global, Site, and Tab into a single proof field; the settings page expands the same language into a stable indexed workspace. Words, lamps, switch positions, and structure always carry state alongside color. The implemented direction is concept seed `37cd53b6`.

**Key Characteristics:**

- Cool, lightly textured proof stock bounded by fine ink rules.
- CMY process marks and registration targets tied to scope and protection state.
- Black control bars and active navigation registers for operational authority.
- Condensed uppercase production headings with readable Ubuntu body copy and Ubuntu Mono data.
- Crisp controls, restrained corner radii, and flat ledger-like grouping.
- Light and dark themes that preserve contrast and the same process-color hierarchy.

## Colors

The palette separates three jobs: teal operates controls, CMY identifies the registration system, and green proves an active protected state.

### Primary

- **Control Teal:** Primary actions, links, and the user-configurable interface accent. Its deeper and washed companions handle hover and quiet feedback.
- **Dark-Surface Focus:** A separately contrast-clamped focus ring for the fixed registration-ink top bar; it never inherits an unreadable dark custom accent.

### Secondary

- **Process Cyan:** The first registration layer, Global scope marker, logo offset, and the active navigation locator.
- **Process Magenta:** The second registration layer, Site scope marker, and middle process channel.
- **Process Yellow:** The third registration layer, Tab scope marker, pause lamp, and final process channel.

### Tertiary

- **Registered Green / Mint:** Active-protection lamps and their readable outlines. These colors indicate proof of state, never ordinary actions.
- **Fault Red:** Destructive actions, recoverable errors, and danger emphasis only.

### Neutral

- **Proof Stock / Raised / Muted / Deep:** The cool paper hierarchy for the canvas, fields, indexed rails, and recessed proof areas.
- **Registration Ink:** Primary text, black instrument bars, selected navigation, and the strongest rules.
- **Soft / Faint Ink:** Supporting explanations, data captions, and low-emphasis metadata.
- **Proof Lines:** Hairline structure; the strong line is reserved for control edges and major registers.
- **Night Proof / Raised / Ink:** The dark-mode foundation. Dark mode remaps every semantic token and uses screen blending for CMY layers so registration remains legible.

**The Three-Job Color Rule.** Teal means action or focus, CMY means process and scope, and green means registered protection. Do not exchange those roles.

**The Color-Plus-Proof Rule.** A colored state must also expose a word, switch position, lamp treatment, or structural change.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow and sans-serif fallbacks)

**Body Font:** Ubuntu (with system UI and sans-serif fallbacks)

**Label/Mono Font:** Ubuntu Mono (with UI monospace and monospace fallbacks)

**Character:** Barlow Condensed gives headings the direct, space-efficient voice of production marks and press labels. Ubuntu keeps explanations humane and legible; Ubuntu Mono is reserved for browser values, counts, status codes, version strings, shortcuts, and compact production labels.

### Hierarchy

- **Display** (700, fluid 44–66px, 0.92): Uppercase settings-page section headings; it is never body copy.
- **Title** (700, 25–31px, 0.95–1.05): Popup origins, configuration titles, brand wordmarks, and proof-state headings.
- **Body** (400–700, 12–16px, 1.45–1.55): Explanations, setting labels, and actions, generally capped near 68–72 characters.
- **Data** (400–700, 11–13px, compact): URLs, measurements, codes, scope labels, state readouts, versions, and tabular values.

**The Production-Heading Rule.** Barlow Condensed headings are uppercase, tightly led, and reserved for hierarchy; never use the face for paragraphs.

**The Data-Only Mono Rule.** Ubuntu Mono communicates a browser value, measurement, status, shortcut, or production code. It is not decorative technology styling.

## Layout

The popup is a fixed 400px-wide, minimum 580px-high proof sheet. Its origin header leads to one bordered registration field, a three-cell activity ledger, and a compact action footer. Within the proof field, the registration target takes 46% of the stage and the current-tab control takes 54%.

The settings workspace uses a 72px black top bar, a 260px indexed side rail, and a scrollable content field capped at 1240px. Major sections use generous canvas padding, but settings themselves read as rows, tables, and ledgers before they become enclosed sheets. The overview proof is a three-part field: target, registered state, and scope matrix.

At 980px and below, the side rail becomes sticky horizontal navigation beneath the top bar; both primary and support destinations remain in the same scrollable sequence. At 600px and below, the overview proof, forms, appearance layout, diagnostics, and about content become single-column; the activity ledger becomes two columns. Controls keep their minimum target heights.

**The Process-Rail Exception.** The settings workspace's full-width 4px top CMY rail, 6px side CMY rail, and the popup's 5px top CMY rail are intentional print-registration control strips. They are not decorative thick colored borders. At 980px the settings side rail rotates into a 4px horizontal strip beneath navigation.

## Elevation & Depth

The system is flat by default. Paper tone, ink rules, crop marks, and adjacent ledgers establish depth; resting panels do not float. Shadows are reserved for transient or physically lifted cues: the toast, the active signal lamp, and keyboard keycaps.

### Shadow Vocabulary

- **Registered lamp** (`0 3px 9px color-mix(in srgb, var(--signal-bright) 38%, transparent)`): A small local glow proving active protection.
- **Keycap** (`0 3px 7px rgba(0,0,0,.12)`): A shallow physical edge under keyboard shortcuts.
- **Transient toast** (`0 12px 30px rgba(0,0,0,.26)`): The only broad overlay shadow.

**The Proof-First Rule.** Add hierarchy with paper tone, a one-pixel rule, or a crop mark before considering shadow.

## Shapes

The form language is crisp and press-like. Navigation registers use 3px corners, common controls use 4px corners, transient utility surfaces use 6px corners, and complete proof or configuration sheets may use 10px corners. One-pixel rules do most structural work.

Circles belong to functional registration geometry and status lamps. Crop-mark corners and square-ended icon strokes reinforce alignment. Pills, oversized soft radii, and decorative blobs do not belong in this world.

## Components

### Buttons

- **Shape:** Rectangular with restrained 4px corners and a 40px minimum height.
- **Primary:** Control-teal fill, high-contrast accent ink, firm weight, and 8px × 15px padding.
- **Hover / Focus:** Primary controls deepen; secondary controls move from raised to muted proof stock. All controls use the shared two-pixel focus outline with a three-pixel offset and press down by one pixel when active.
- **Secondary / Quiet / Danger:** Secondary actions use raised stock and a strong rule; quiet actions remove the enclosure; danger actions use fault red without changing the control geometry.

### Switches

- **Style:** A 64 × 32px rectangular track with 4px corners, a 24px square handle, and literal ON/OFF text.
- **State:** Inactive uses muted paper and strong line; active reverses to registration ink and moves the handle 31px, turning it process cyan. The popup's principal tab switch scales to 78 × 38px.
- **Motion:** State changes use the shared exponential ease-out. Reduced-motion mode collapses transitions to effectively instant feedback.

### Inputs / Fields

- **Style:** Raised proof stock, a one-pixel line, 4px corners, 42px minimum height, and 8px × 11px padding.
- **Focus:** The border becomes control teal while the global focus-visible outline remains present.
- **Error / Disabled:** Fault red identifies errors and destructive actions; disabled controls retain their geometry at reduced opacity with a blocked cursor.
- **Drafts:** Editable settings show saved/unsaved state and a discard action. An unrelated toggle must not overwrite a draft. Loading failures remain visible with a retry action.

### Live controls and records

Popup scope labels report actual global, site, and tab state. A disabled tab control explains which higher-precedence policy blocks it. Exact-domain exceptions have a direct resume action; broader rules open the exception editor.

Logs and site activity use searchable flat rows, showing 50 records initially and 50 more on request. Stored logs remain available when logging is turned off. Long domains and event details wrap inside their column.

The shared palette in `styles/theme.js` independently calculates default and hover text colors. Custom accent links meet 4.5:1 and control/focus boundaries meet 3:1 against the supported light/dark surfaces. Forced-colors mode uses system colors. Between 981 and 1250px, the overview places scope rows below the state proof and settings forms use a single column.

### Navigation

The desktop index pairs an 11px mono production code with a plain-language destination in a 44px register. Hover uses raised proof stock and a line; the active destination reverses to registration ink with proof-stock text and a cyan locator. At 980px, codes and locator dots hide while the same destinations become a horizontally scrollable sticky sequence.

### Registration Proof

The signature proof consists of three circular CMY layers, orthogonal crosshairs, a black center register, explicit Global/Site/Tab labels, and a written state. Inactive and paused states keep the layers visibly offset. Active protection translates all three layers to zero, briefly resolves blur, and settles with a one-pixel mechanical correction. Dark mode changes layer blending from multiply to screen; reduced-motion mode shows the aligned result without animation.

### Sheets and Ledgers

Complete configuration tasks may use a raised proof sheet with a 10px radius, a strong one-pixel border, one crop-mark corner, and a short CMY register at the top edge. Routine settings, metrics, logs, and tables remain flat rows divided by hairlines; enclosure is reserved for a coherent task or proof.

## Do's and Don'ts

### Do:

- **Do** preserve Global → Site → Tab as the scope order wherever protection registration is summarized.
- **Do** use the CMY target snapping into alignment as the reusable visual proof of active protection.
- **Do** keep state explicit through text, switch position, and structure as well as color.
- **Do** preserve accessible contrast, visible focus, reduced-motion behavior, and the semantic light/dark token mapping.
- **Do** keep all primary and support navigation reachable when the side index becomes horizontal at 980px.
- **Do** treat the full-width top and side CMY rails as intentional registration control strips.

### Don't:

- **Don't** reinterpret process rails as accidental thick borders or remove them during generic border cleanup.
- **Don't** turn settings into a uniform wall of floating cards; use rows, ledgers, tables, and bounded sheets according to task structure.
- **Don't** use CMY as arbitrary decoration, teal as protection proof, or green for ordinary actions.
- **Don't** introduce remote fonts, icon services, pill controls, oversized soft radii, gradients unrelated to process rails, or hacker-console theater.
- **Don't** animate registration indefinitely; it resolves once into a stable, verifiable state.
