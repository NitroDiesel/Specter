# Specter product context

## Product

Specter is a privacy-focused browser extension for people who need websites to keep receiving an active, visible browser state. It provides a fast per-tab control surface and a complete settings workspace without sending usage data to remote services.

## Platform and operating context

- Desktop browser extension for Chrome, Firefox, Floorp, and compatible Chromium or Firefox derivatives.
- The popup is a compact, frequently used control surface constrained by browser-extension dimensions.
- The settings page is a full-tab workspace for configuration, diagnostics, logs, site activity, imports, and exports.
- All assets and runtime code must be bundled locally and compatible with the extension content-security policy.

## Audience

Privacy-conscious browser users who want clear control over how sites perceive browser visibility, focus, activity, and fullscreen state. Users range from people who need a one-click current-site control to advanced users tuning event behavior and timing.

## Core capabilities

- Global protection and per-tab protection controls.
- Immediate on/off lifecycle behavior without requiring a manual page reload where supported.
- Visibility, focus, and fullscreen state handling across supported browser families.
- Site exceptions and temporary pauses.
- Synthetic activity and decoy timing controls.
- Optional local event logs and site-activity summaries.
- Import, export, diagnostics, shortcuts, and environment reporting.
- Theme mode, accent color, and typeface preferences.

## Brand commitments

- Name: Specter.
- Character: quiet, exact, capable, private, and local-first.
- The interface should feel like a focused browser instrument, not a generic settings template or a theatrical hacker dashboard.
- State must be obvious through words, structure, and shape—not color alone.
- Controls must remain keyboard-accessible, legible in light and dark themes, and respectful of reduced-motion preferences.

## Design constraints

- Use only Specter's own components, tokens, iconography, typography, terminology, and visual patterns.
- Use local SVG or CSS iconography; do not add remote fonts, icon services, UI frameworks, or runtime dependencies.
- Preserve every current capability and stored-setting schema unless a compatibility migration is included.
- Keep the popup decisive and compact; keep advanced configuration in the settings page.
- Favor crisp borders, restrained radii, typographic hierarchy, and operational status cues over stacked floating cards.
