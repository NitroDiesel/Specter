---
name: Specter
description: uBlock Origin's layout in T3 Code's skin and motion.
colors:
  background: "#fcfcfc"
  surface: "#ffffff"
  surface-muted: "#fafafa"
  surface-hover: "#f4f4f5"
  border: "#e4e4e7"
  border-strong: "#d4d4d8"
  foreground: "#27272a"
  muted-foreground: "#71717b"
  primary: "#1b4ed8"
  success: "#009966"
  warning: "#e17100"
  danger: "#e7000b"
  dark-background: "#000000"
  dark-surface: "#0a0a0a"
  dark-surface-hover: "#191a1d"
  dark-border: "rgb(255 255 255 / .08)"
  dark-foreground: "#f1f3f7"
  dark-muted-foreground: "#a3a3a3"
  dark-primary: "#466fe0"
typography:
  ui: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif (default); bundled Ubuntu and Ubuntu Mono are optional"
  mono: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
  page-title: "20px / 600 / -0.015em"
  row-title: "13.5px / 600"
  body: "13-14px / 400"
  caption: "12-12.5px / 400-500, muted"
rounded:
  sm: "6px"
  md: "8px (buttons, fields, tabs)"
  lg: "10px (radius base, toasts)"
  xl: "14px (cards and grouped rows)"
  full: "switches, power button, status dots"
motion:
  default: "150ms cubic-bezier(.4, 0, .2, 1)"
  enter: "opacity 0 + scale .98, 200-260ms cubic-bezier(.22, 1, .36, 1)"
  drawer: "320ms cubic-bezier(.32, .72, 0, 1) for toasts"
  status-ping: "2s steps(8) scale .75 to 2, opacity .9 to 0"
  skeleton: "1.6s steps(4) opacity 1 to .55"
  shine: "1.1s linear sweep while busy"
---

# Design System: Specter

## Overview

Specter borrows two proven references and keeps them in separate jobs:

- **Layout from uBlock Origin.** The popup reads top to bottom like uBO's: the current hostname, one large power button for the current tab, a label/value counter list, compact per-scope state, the site-pause action, and a bottom tool row. The settings page is a dashboard with a horizontal tab strip, not a sidebar.
- **Skin and motion from T3 Code.** Zinc neutrals, an indigo primary, pure-black dark mode, hairline borders, a 10px radius scale, the system font stack, a faint SVG grain on chrome surfaces, pill switches, and T3's motion vocabulary: quick eased transitions, panels and popovers that enter with opacity and a 98% scale, toasts that slide up on a drawer curve, stepped status pings, stepped skeletons, and a shine sweep while work is in flight.

Tokens were taken from T3 Code's shipped stylesheet (`--background`, `--card`, `--accent`, `--border`, `--input`, `--primary`, radius, shadow, and easing values), mapped onto Specter's own token names in `styles/tokens.css`.

## Colors

- **Neutrals** carry nearly all of the interface: background, card surface, muted chrome (toolbar, table headers, preview bars), hover, and two border weights. Dark mode is true black with an off-black card, translucent white borders, and `#a3a3a3` muted text, as in T3 Code.
- **Primary** (`--accent`) is the user-configurable action color: primary buttons, active switches, the active tab underline, focus rings, and the active power button. `styles/theme.js` derives light and dark variants from the chosen seed, clamps them to at least 3:1 on every surface (4.5:1 for text), and prefers white ink when it reaches 4.5:1.
- **Status colors** prove state and never decorate: emerald for protection active, amber for paused, red for destructive actions and errors.

**State is never color alone.** Every colored status also has a word (Protection active, Paused, On/Off), a switch position, or a shape change.

## Typography

The default typeface is the operating-system UI font, matching T3 Code. Users can switch to the bundled Ubuntu or Ubuntu Mono. Monospace is reserved for literal machine values that people may copy or compare: URLs, site patterns, domains in tables, record JSON, error reports, and key combinations. Counts, versions, and status text use the UI face with tabular figures.

Hierarchy stays compact: 20px page titles, 13.5px row titles, 13-14px body, and 12-12.5px muted captions. Avoid uppercase display type and decorative letter spacing.

## Layout

### Popup (360px)

1. A toolbar with the brand (opens the dashboard) and the global switch with its state word.
2. The hostname and full URL, with a focus-tab action.
3. A 108px round power button for the current tab, with a state title and an explanation underneath. Active fills with the primary color, a soft halo, and a one-time ring pulse. Paused turns amber. Unavailable pages show a muted, disabled button.
4. A status line (live dot plus state) and the logging state.
5. uBO-style counters: sites observed, events logged, and site exceptions.
6. Three scope tiles in precedence order: Global, Site, Tab.
7. The site-pause duration and action, which becomes Resume or Manage when an exception applies.
8. A bottom tool row: Dashboard, Shortcuts, and the Local only note.

### Dashboard

A sticky translucent header holds a 52px toolbar (brand with version badge, Essentials/Advanced segmented control, global state and switch) above a uBO-style tab strip. Primary destinations sit on the left; Diagnostics, Shortcuts, and About sit on the right after a spacer. Advanced-only tabs (Event log, Diagnostics) hide in Essentials.

Content is capped at 880px. The overview leads with the protection state, then local counters as label/value rows (the same treatment as the popup, not stat tiles), then links to each area. Settings are grouped rows inside 14px-radius cards; complete tasks (synthetic activity, decoy timing) get their own cards; records use searchable tables and lists. At 860px forms and cards become single-column; at 640px the toolbar wraps under the brand and the tab strip scrolls horizontally.

## Components

- **Buttons:** 32px high, 8px radius, 13px medium text. Secondary buttons are card-colored with a strong hairline and an extra-small shadow. Primary buttons are filled with an inset top highlight and brighten on hover. Quiet and danger variants keep the same geometry. All buttons press to 98% scale.
- **Switches:** 36x20 pills with a 16px white thumb that slides on the expo curve. The off track is dark enough for 3:1 contrast.
- **Fields:** 32px high, strong hairline, primary-colored focus border with a soft 3px ring. Selects use a local SVG chevron.
- **Tabs:** muted 13px labels with 16px stroke icons, a rounded hover wash, and a 2px primary underline that scales in.
- **Cards and rows:** hairline borders and 14px radius, with rows divided by hairlines. Hover washes use `--surface-hover`.
- **Status dot:** an 8px dot. Only the popup's live status dot pings while protection is active.
- **Toast:** a card-colored popover with a primary dot. It slides up from the bottom (centered in the popup, bottom-right in the dashboard).
- **Icons:** local inline SVG, 24 viewBox, 1.75 stroke, round caps and joins. No icon fonts or remote services.

## Motion

Use only T3 Code's motion vocabulary, and only where it answers an action or reports live state. The one orchestrated moment is the power button turning on (fill, halo, single ring pulse). Everything else either responds to the person (tab switches, toasts, switches, menus) or reports work in flight (status ping, skeleton, shine). Do not add staggered page-load entrances, per-row entrances, or hover nudges. Transitions default to 150ms on the standard curve; panels enter with opacity and a 98% scale, or a 6px rise when switching dashboard sections. Live indicators use stepped animations rather than smooth loops. `prefers-reduced-motion` collapses all transitions and animations, and `forced-colors` falls back to system colors.

## Do's and Don'ts

- **Do** keep every feature reachable: Global, Site, and Tab controls; pause and resume; logs and site activity with search and pagination; import and export; appearance; diagnostics; and shortcuts.
- **Do** keep the popup's single dominant control (the power button), as uBO does.
- **Do** keep assets local and compatible with the extension CSP. The grain and chevron are inline data URIs.
- **Don't** add gradients, decorative color, or uppercase display headings. Primary surfaces (the power button, logo, and preview) are flat.
- **Don't** join metadata with middle dots or label every block with a heading. Copy names the result of an action ("Exception added" for Add exception), errors say what to do next, and empty states invite the next step.
- **Don't** animate continuously except for live status indicators and in-flight work.
