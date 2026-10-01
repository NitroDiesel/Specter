# Changelog

## Unreleased

## [1.1.1] - 2026-10-01

### Reliability and hardening

- Restored per-tab overrides whenever the background worker restarts, and kept them in session storage so reused tab IDs cannot inherit stale overrides after a browser restart.
- Delivered live configuration to every frame in a tab once, including frames that loaded before a worker restart.
- Bounded page-supplied telemetry: oversized payloads are dropped, metrics are ignored while activity logging is off, and stored details are truncated.
- Site activity now counts recorded blocked events instead of always showing zero.
- Popup tab toggles target the named tab even when the popup is opened as a tab.
- Packaging resolves `python3` or `python`.
- Clarified that automatic reload interrupts in-page downloads, uploads, and unsaved forms.

## [1.1.0] - 2026-09-07

### Live controls and settings reliability

- Added direct site resume, explicit policy precedence, unsupported-page guidance, and retry states to the popup.
- Preserved unsaved settings across unrelated actions, with save/discard feedback and persistent section links.
- Added search and incremental loading for all retained activity records and sites.
- Shared strict, contrast-tested accent generation between popup and settings, including independent hover text colors.
- Validated imports before applying them and prevented queued activity writes from replacing newer settings.
- Corrected the fullscreen pause notice to follow the resolved policy.
- Added browser UI coverage and regression tests for imports, deferred writes, fullscreen notices, colors, and packaged assets.

### Chromatic Registration interface

- Rebuilt the popup and settings experience as a responsive proofing instrument with explicit Global, Site, and Tab state alignment.
- Added local Barlow Condensed display type, CMY registration targets, crop-mark geometry, dark-mode proof surfaces, and an offline raster stock texture without adding runtime dependencies.
- Made saved accent colors contrast-aware and raised functional microcopy to an accessible reading size.

## [1.0.8] - 2026-08-11

### Firefox-family teardown hardening

- Observed the Promise that Gecko derivatives may return from the callback-compatible runtime API, preventing a destroyed frame from surfacing an unhandled `RuntimeMessage` rejection.
- Deferred initial background messaging in provisional Gecko subframes until `DOMContentLoaded` while keeping main-world protection active from `document_start`.

## [1.0.7] - 2026-08-11

### Extension coexistence

- Documented Specter's main-world/isolated-world boundary for browser-assistance extensions.
- Added a regression proving that protected page listeners cannot suppress lifecycle events observed by an isolated extension, including browser-control tools.
- Added shortcut diagnostics that expose unassigned or conflicting browser commands instead of failing silently.
- Changed the current-tab default to `Alt+Shift+L`, which Chrome assigns on fresh installs instead of silently rejecting.
- Routed Firefox-family bridge messages through the callback-compatible runtime to avoid rejected promises when a frame unloads.
- Kept internal page-unload cleanup outside the protected page-listener gate so timers are cancelled cleanly in destroyed frames.
- Avoided unnecessary session-storage reads in embedded frames when reload-on-activation is disabled.

## [1.0.6] - 2026-08-08

### Firefox-family compatibility

- Replaced Firefox-branded user-agent checks with WebExtension capability detection so rebranded Gecko derivatives open the correct extension settings page.
- Prevented page hooks from initializing in browser extension documents and set Gecko 152 as the tested compatibility floor for reliable packaged content-script loading.
- Documented the shared Firefox-family package for maintained Gecko derivatives such as LibreWolf, Floorp, and Zen Browser.
- Added live derivative-browser validation for focus protection, frames, handler properties, repeated toggles, and the CodePen active-tab test.

## [1.0.5] - 2026-08-06

### Always-on focus protection

- Replaced the one-shot page bridge with an idempotent retry handshake so live settings always reach early-loading pages and frames.
- Prevented delayed startup responses from overwriting a newer user toggle.
- Extended live focus blocking to element `onfocus`/`onblur` property handlers and every supported window/document lifecycle handler.
- Applied site pause and resume changes to every open frame immediately, without a page reload.
- Added repeated toggle, lifecycle-event, iframe, handler-property, listener-semantics, and startup-race regression coverage.

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
- Rebuilt the settings page with a responsive visual system and Essentials/Advanced modes.
- Added live light, dark, and system theme previews with a configurable blue default.
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
- Added a compact popup plus comprehensive options dashboard with seed-based theming, logging/activity controls, and import/export tools.
- Added default keyboard shortcuts (Ctrl/Cmd+Shift+K and +L) to toggle Specter globally or per-tab.
- Expanded preset export/import to cover the full settings payload and support drag-and-drop restore in the options UI.
- Bundled local interface fonts and a Specter-branded icon suite for fully offline operation.
- Provided build tooling (`scripts/build.js`) to package Chrome and Firefox archives.
