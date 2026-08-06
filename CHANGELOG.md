# Changelog

## [1.0.4] - 2026-08-06

### Live protection toggles

- Kept visibility and focus listeners behind state-aware wrappers so protection can be disabled and re-enabled without reloading the page.
- Applied the same live-toggle behavior to `onblur`/`onfocus` handlers and element focus blocking.
- Preserved native listener removal, capture, one-shot, and abort-signal behavior while protection changes state.

## [1.0.3] - 2026-08-06

### Error cleanup

- Made legacy main-world script cleanup existence-aware and single-run.
- Treated Chrome's `Nonexistent script ID` response as the expected no-op it represents, preventing false extension errors after startup or updates.

## [1.0.2] - 2026-07-26

### Tab-switch reliability

- Moved the main-world visibility and focus hooks to static `document_start` injection so inline page handlers cannot register before Specter.
- Added opaque-origin fallback matching for `about:srcdoc`, `about:blank`, `data:`, and `blob:` frames.
- Added a one-time, pre-page bridge handshake between the main and isolated worlds.
- Fixed focus/blur protection on the CodePen active-tab test and similar iframe-based pages.

## [1.0.1] - 2026-07-21

### Browser compatibility

- Declared that Specter collects and transmits no data using Firefox's built-in data-consent manifest field, making new AMO submissions compliant.
- Raised the minimum Firefox version to 142 so the release uses that manifest field consistently across supported Firefox builds.
- Replaced dynamic settings-page HTML rendering with DOM construction so Mozilla's extension linter can verify the UI without unsafe-assignment warnings.

## [1.0.0] - 2026-07-16

### Product interface

- Reworked the popup around active-tab status, protection, temporary site pauses, and truthful local activity counts.
- Rebuilt the settings page with a modern Google Material visual system, responsive navigation, and Recommended/Advanced modes.
- Added live light, dark, and system theme previews with a modern Google blue default.
- Removed estimated "data saved" and "time saved" claims that were not based on measured values.

### Public release readiness

- Added privacy, security, contribution, issue, pull request, and ownership documentation.
- Added manifest, HTML, and JavaScript validation plus GitHub CI and tagged-release workflows.
- Reduced web-accessible resources and removed the redundant `activeTab` permission.
- Restricted release archives to extension runtime files and excluded generated packages from version control.
- Escaped locally stored values before rendering them into extension pages.
- Replaced fixed page bridge events with per-frame private channels and corrected initial configuration delivery.
- Made global disable, site exceptions, and fullscreen pauses take precedence over per-tab overrides.
- Corrected root-domain and exact-origin exception matching and completed fullscreen preference backup/restore.
- Added automated policy and archive tests, deterministic Chrome/Firefox packages, and third-party asset notices.

## [0.2.0] - 2026-01-12
### Stability Improvements
- Added debug logging utility with configurable log levels for better troubleshooting.
- Implemented service worker state persistence for per-tab overrides and paused state.
- Added message retry logic with exponential backoff for transient messaging failures.
- Improved main-world injection with MutationObserver fallback for edge cases.
- Added SPA navigation detection via History API monitoring (pushState/replaceState).

### New Features
- Added "Pause in fullscreen" toggle in options to control fullscreen behavior.
- Schema migration updated to version 2 with pauseInFullscreen support.

### Testing
- Expanded test-suite.html with comprehensive API, event, leakage, and iframe tests.
- Added organized test results display with pass/fail tracking.
- Added SPA navigation test utility.

## [0.1.0] - 2024-10-XX
- Initial public release of Specter.
- Added MV3 background worker with per-tab/per-site state, allowlist, badge states, and messaging.
- Added injected main-world spoofing engine with event interception, fake activity, and fullscreen pause handling.
- Added MD3 popup plus comprehensive options dashboard with seed-based theming, logging/heatmap controls, and import/export tools.
- Added default keyboard shortcuts (Ctrl/Cmd+Shift+K and +L) to toggle Specter globally or per-tab.
- Expanded preset export/import to cover the full settings payload and support drag-and-drop restore in the options UI.
- Bundled Roboto/Ubuntu fonts, Material Symbols, and a Specter-branded icon suite for fully offline operation.
- Provided build tooling (`scripts/build.js`) to package Chrome and Firefox archives.
