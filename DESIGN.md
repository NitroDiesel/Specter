---
name: Specter
description: A quiet signal ledger for private browser-state control.
colors:
  instrument-paper: "#f3f1e8"
  raised-paper: "#fffef8"
  muted-paper: "#e8e7df"
  ledger-ink: "#101820"
  soft-ink: "#4e5b64"
  hairline: "#bfc2ba"
  cobalt-signal: "#2449d8"
  cobalt-deep: "#1737b0"
  cobalt-wash: "#dfe5ff"
  live-lime: "#b8f33d"
  live-green: "#547500"
  fault-red: "#b63d37"
  night-paper: "#0f1418"
  night-raised: "#161d22"
  night-ink: "#edf0e9"
typography:
  display:
    fontFamily: "Ubuntu, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Ubuntu, system-ui, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Ubuntu, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Ubuntu Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: "7px"
  panel: "14px"
spacing:
  tight: "8px"
  control: "12px"
  group: "16px"
  section: "36px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt-signal}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.ledger-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  field:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.ledger-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "40px"
---

# Design System: Specter

## Overview

**Creative North Star: "The Signal Ledger"**

Specter behaves like a quiet browser instrument: live state is legible at a glance, while configuration reads as a durable local record. The system combines warm paper surfaces, precise ink lines, and one bright live-state signal. It is operational without becoming theatrical or imitating a terminal.

The popup compresses Origin → Global → Site → Tab into one signal path. The settings page expands the same language into an indexed ledger. Controls say what they do, status is never color-only, and every advanced capability remains reachable at narrow widths.

**Key Characteristics:**

- Flat paper and ink surfaces separated by hairlines.
- Cobalt for actions; lime and green only for live state.
- Large, compact Ubuntu headings paired with Ubuntu Mono data labels.
- Rectangular controls with restrained corners and explicit ON/OFF state.
- One authored trace motion, with reduced-motion fallback.

## Colors

The palette separates action from status: cobalt moves the interface, while lime confirms that a browser-state channel is live.

### Primary

- **Cobalt Signal:** Active buttons, links, focus, and the user-selected appearance accent.
- **Cobalt Deep:** Hovered actions and high-contrast links on light paper.
- **Cobalt Wash:** Quiet hover and informational surfaces.

### Secondary

- **Live Lime:** Small lamps, switch handles, and trace endpoints that prove an active state.
- **Live Green:** Live-state outlines and readable status text where the brighter lime would be too loud.
- **Fault Red:** Destructive actions and error states only.

### Neutral

- **Instrument Paper:** The principal light canvas.
- **Raised Paper:** Fields, panels, and controls that sit above the canvas.
- **Muted Paper:** Rails, quiet channels, and grouped controls.
- **Ledger Ink:** Primary text, strong rules, and the darkest structural surface.
- **Soft Ink:** Explanations and secondary labels.
- **Hairline:** Dividers, table rules, and inactive control borders.
- **Night Paper / Night Raised / Night Ink:** The dark-mode canvas, elevated surface, and text trio.

**The Two-Signal Rule.** Cobalt always means an action or focus target; lime and green always mean live protection state. Do not exchange their roles.

**The Color-Plus-Words Rule.** Every colored state must also expose an explicit label, switch text, or structural change.

## Typography

- **Display font:** Ubuntu (with system sans fallback)
- **Body font:** Ubuntu (with system sans fallback)
- **Label/mono font:** Ubuntu Mono (with UI monospace fallback)

**Character:** Ubuntu gives Specter a humane, recognizable utility voice. Ubuntu Mono is reserved for measurements, codes, URLs, shortcuts, counts, and compact status labels.

### Hierarchy

- **Display** (700, fluid 32–52px, 1.02): Full-page section headings; never used inside the popup.
- **Title** (700, 23px, 1.15): Active origins and major control groups.
- **Body** (400, 16px, 1.5): Explanations and settings copy, kept near a 72-character measure.
- **Label** (700, 10–12px, compact line height): Uppercase data codes, channel names, and status readouts.

**The Data-Only Mono Rule.** Monospace communicates a browser value, measurement, status code, or shortcut. It is not a decorative technology voice.

## Layout

The popup is a fixed compact sheet with an origin header, integrated signal board, three-cell activity ledger, and action footer. The full settings page uses a 238px fixed index rail and a reading field capped near 1180px. Content is grouped by rules and spacing before it is enclosed by a panel.

At 900px and below, the rail becomes a sticky horizontal index. Both primary and support destinations remain in one scrollable sequence. At 560px and below, forms and metric ledgers stack while controls retain their full target size.

Spacing follows four recurring beats: 8px inside tight controls, 12px around compact controls, 16px within groups, and roughly 36px between major reading sections.

## Elevation & Depth

The system is flat by default. Strong ink rules establish structure; muted and raised paper establish layer. Soft, downward shadows are limited to transient overlays, keyboard keys, the selected mode control, and active lamps.

**The Paper-First Rule.** Add depth with paper tone and a rule before adding shadow. A shadow must describe an actual lifted or transient surface.

## Shapes

Controls use compact 7px corners. Larger bounded instruments use 14px corners. Status lamps and trace endpoints are small squares with slight rounding; pills are not part of the component language. Hairlines stay one pixel, with dark ink reserved for the outer frame or a primary register.

## Components

### Buttons

- **Shape:** Compact rectangular control with gently curved corners.
- **Primary:** Cobalt fill, high-contrast text, and a 38px minimum height.
- **Hover / Focus:** Deeper cobalt on hover; a two-pixel focus outline with a three-pixel offset.
- **Secondary / Quiet:** Raised paper with a firm border, or a transparent text action where enclosure would add noise.

### Switches

- **Style:** A 54×30px rectangular track with a squared handle and literal ON/OFF label.
- **State:** Inactive uses muted paper and soft ink; active uses the live-state pair. Movement is a short exponential ease-out translation.

### Cards / Containers

- **Corner Style:** Larger 14px corners only for complete instruments or configuration sheets.
- **Background:** Raised paper against the main canvas.
- **Shadow Strategy:** None at rest.
- **Border:** One hairline or one strong ink frame, never both plus a shadow.
- **Internal Padding:** Usually 24px for full configuration sheets.

### Inputs / Fields

- **Style:** Raised paper, one hairline, compact corners, and at least 40px height.
- **Focus:** Accent border plus the shared focus outline.
- **Error / Disabled:** Fault red for recoverable errors; reduced opacity and blocked pointer affordance when disabled.

### Navigation

The desktop index pairs a compact data code with a plain-language destination. The active destination reverses to ledger ink with paper text. Narrow layouts keep the same destinations in a sticky horizontal sequence with a visible native scrollbar.

### Signal Trace

The recurring trace is thin, geometric, and functional. A short clip reveal may announce the loaded state; active endpoints use the live-state pair. Reduced-motion mode shows the completed trace immediately.

## Do's and Don'ts

### Do:

- **Do** preserve the Origin → Global → Site → Tab reading order anywhere protection state appears.
- **Do** use literal state labels and keep controls keyboard accessible.
- **Do** reserve bounded panels for complete instruments, forms, or task contexts.
- **Do** verify every primary and support destination remains reachable at narrow widths.

### Don't:

- **Don't** replace the ledger with same-sized stacks of generic setting cards.
- **Don't** use remote fonts, icon services, or runtime UI frameworks.
- **Don't** use lime for ordinary actions or cobalt as the only proof of protection state.
- **Don't** introduce pill-shaped switches, floating action controls, ornamental grids, or theatrical hacker styling.
