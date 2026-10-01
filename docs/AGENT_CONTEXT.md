# Specter agent handoff

Last verified: 2026-09-07. Treat Git state, browser versions, releases, and public assets as snapshots; refresh them before making current claims.

## Resume here

1. Run `git status --short --branch`, inspect the current diff, and compare the branch with its remote before changing files.
2. Read `PRODUCT.md` for product truth and `DESIGN.md` for the visual contract.
3. Identify whether the task affects policy, page injection, browser packaging, stored settings, or UI. Apply the matching verification gate below.
4. Preserve unrelated local changes. Use the Git history and release page to determine whether this checkout is ahead of the published version.

Completion means the requested change is implemented, relevant tests and browser checks pass, generated packages contain the intended files, and Git/publication state is reported exactly.

## Current repository snapshot

- Repository: `NitroDiesel/Specter`.
- Product: Manifest V3 desktop browser extension for Chromium and Firefox-family browsers.
- This handoff describes the `1.2.1` release source in `manifest.json` and `package.json`.
- Development branch: `codex/chromatic-registration-redesign`, based on `ebcf993`, the merge of PR #5.
- The user authorized finalization, merge, and GitHub publication on September 6.
- Publication status is not cached here. Check `main`, the `v1.2.1` tag, the release workflow, and [the release page](https://github.com/NitroDiesel/Specter/releases/tag/v1.2.1) before claiming publication.

The redesign changes the popup, settings UI, overlay, logo, background default accent, shared tokens/type/base styles, docs, validation, package tests, and third-party notices. It adds local Barlow Condensed fonts, their OFL license, and `assets/proof-stock.png`. Generated `specter-chrome.zip` and `specter-firefox.zip` files are ignored release artifacts, not evidence of publication.

For subsequent releases, synchronize `manifest.json`, `package.json`, and `CHANGELOG.md`, rerun every release gate, then commit/PR/merge/tag only with user authorization.

### September 6 revision

The local revision keeps the existing visual direction and plain JavaScript architecture. The user explicitly asked to avoid overengineering. Keep further changes tied to a demonstrated defect or requested feature.

- Popup controls now explain global disable, site exceptions, fullscreen pause, and unsupported pages. Exact-domain pauses can be resumed directly; broader rules open Exceptions. Busy and failed-load states prevent misleading actions.
- Settings forms preserve unsaved edits during unrelated actions and offer save/discard feedback. Logs and site activity have search and incremental display of all retained records. Section links survive reloads.
- `styles/theme.js` replaces duplicate palette code. Strict color parsing and independently contrasted default/hover foregrounds keep user-selected accents readable in both themes.
- Imports validate before modifying cached settings. An explicit settings save cancels an older deferred activity snapshot. The fullscreen notice now follows the resolved pause policy.
- `tests/browser-ui.cjs` adds an optional browser integration suite without adding runtime dependencies. See the commands below.

These changes form the v1.1.0 release revision. No universal detection bypass or new fullscreen-exit spoofing was implemented in this revision.

## Product and policy model

Specter keeps supported pages observing an active, visible browser state while giving the user explicit Global, Site, and Tab controls. Data stays in extension storage; the product has no accounts, analytics, advertising, or remote runtime service.

Policy precedence is intentional:

1. Global disable turns protection off.
2. Site exceptions and active pauses turn protection off for the matching page.
3. A per-tab force-off turns protection off.
4. A per-tab force-on applies only when no higher-precedence global, exception, or pause rule blocks it.
5. Otherwise the global setting applies.

Fullscreen pause is temporary state controlled by `pauseInFullscreen`. Disabling that feature must clear an existing fullscreen pause. Open tabs and frames must receive policy changes immediately.

Preserve the settings schema in `background.js`, including global state, allowlist, logs, heatmap, theme/font, focus blocking, automatic reload, fullscreen pause, synthetic activity, and decoy timing. Add an explicit migration when changing persisted shape.

## Runtime architecture

### `manifest.json`

The content-script order is a correctness boundary:

1. `injected/main-world.js` runs statically in `MAIN` at `document_start` with `all_frames`, `match_about_blank`, and `match_origin_as_fallback`.
2. `content.js` follows in `ISOLATED` with the same timing and frame coverage.

Keep main-world code out of web-accessible resources. Browser-internal pages, extension pages, and vendor-protected surfaces remain outside Specter's reach.

### `injected/main-world.js`

This is the earliest page-world protection layer. It:

- wraps page visibility/focus lifecycle listeners and property handlers;
- makes visibility and focus APIs report active values while protection is on;
- optionally gates element focus handlers;
- preserves listener identity, removal, capture, `once`, and abort behavior;
- gates only the page listener instead of cancelling the native event, so isolated extension observers still receive it;
- starts conservatively while awaiting live configuration;
- uses randomized per-document channels for configuration and local telemetry.

Do not replace the static injection with a late dynamic script. Early inline handlers on the exact CodePen regression page will otherwise win the startup race.

### `content.js`

This isolated-world bridge obtains the current tab/frame policy from the background worker, completes the randomized handshake, relays live configuration, manages the optional overlay and fullscreen pause, and reports bounded local activity. Firefox-family messaging deliberately observes the Promise returned by the callback-compatible `chrome.runtime` path so destroyed frames do not produce unhandled rejections.

Embedded Gecko documents may wait for `DOMContentLoaded` before requesting background configuration, while the main-world guard is already active. Preserve the operation counter that prevents a stale startup response from replacing a newer live toggle.

### `background.js`

This is the source of truth for defaults, migrations, policy resolution, tab overrides, site exceptions/pauses, local logs and heatmap, diagnostics, commands, and popup/options messaging. Tab overrides live in `storage.session` (falling back to `storage.local`) and are restored at every worker start before the first policy push, so they survive worker suspension but not an extension reload or browser restart. Live configuration is broadcast to all frames with one `tabs.sendMessage` call without `frameId`; there is no frame registry. Page telemetry is untrusted: the isolated bridge drops payloads over 8 KB and the worker ignores metrics while activity logging is off. Benign closed-frame messaging failures are ignored; actionable errors are recorded for Diagnostics.

### User interfaces

- `popup/`: fast current-tab control, current origin, protection proof, temporary site pause, local counters, and links to settings/shortcuts.
- `options/`: full settings workspace for protection channels, exceptions, local evidence, appearance, diagnostics, shortcuts, imports, and exports.
- `assets/overlay.css`: small in-page state notice controlled by the isolated bridge.

## Cross-browser contract

- Chrome/Chromium loads the repository root as an unpacked extension. The source manifest uses `background.service_worker`.
- Firefox and compatible Gecko derivatives use the Firefox-family package. `scripts/build.js` changes the packaged background declaration to `background.scripts` without modifying the source manifest.
- The current Firefox floor is Gecko `152.0` and the manifest declares `data_collection_permissions.required: ["none"]`.
- Keep callback-compatible runtime behavior for Firefox and its derivatives. Avoid browser-brand user-agent branches when capability detection is available.
- All code, fonts, icons, textures, and styles are local. Do not add runtime CDNs, UI frameworks, analytics, or remote dependencies.

`scripts/build.js` must continue producing deterministic, runtime-only `specter-chrome.zip` and `specter-firefox.zip` archives. Package checks must verify the target-specific background declaration, Gecko fields, licenses, duplicate/corrupt entries, and absence of repository/development files.

## Tab-switch regression contract

The primary live oracle is:

`https://codepen.io/calebnance/full/nXPaKN`

It embeds the result in an iframe. Test inside that result frame, not only the outer CodePen page. For both Chromium and Firefox-family browsers, verify this sequence without reloading the page:

1. Protection on: page blur/focus and visibility handlers do not observe the protected transition.
2. Protection off: the same handlers receive native transitions.
3. Protection on again: the handlers are blocked again.

Also cover subframes, property handlers, late listeners, element focus handlers, site pause/resume, global toggles, per-tab toggles, startup races, and opaque descendants such as `about:srcdoc`, `about:blank`, `data:`, and `blob:` URLs. Exclude `chrome-extension:` and `moz-extension:` documents.

On September 6, the local suite passed 33/33 Node tests, deterministic packaging checks, Chromium lifecycle E2E, and Firefox 155.0.1 exact-CodePen protected/off/re-enabled checks. The v1.1.0 Firefox rerun reported an empty extension console-error list. An earlier run emitted an intermittent `Promise rejected after context unloaded` warning, so do not claim that browser teardown warnings are eliminated. Other Gecko derivatives were not retested in this revision.

The local `.codex-qa/` folder contains browser helpers in the originating checkout but is ignored and may not exist in a cloud clone. Recreate equivalent live checks when it is absent; do not treat synthetic unit tests as a substitute for the exact-page sequence.

On October 1, the audit-fix branch passed 39/39 Node tests and deterministic packaging. A Playwright run in Helium (Chromium) passed the Global/Site/Tab toggle matrix, three repeated protected → disabled → re-enabled cycles, and a forced service-worker stop from `chrome://serviceworker-internals`, after which a per-tab force-off was restored and still toggled the child frame live; `main` lost the override in the same check. Firefox 157 passed the Firefox E2E, including exact-CodePen protected/off/re-enabled, in 40 consecutive runs after 4 early failures clustered in one two-minute window. In Helium, the probe page occasionally performs a `reload` navigation that does not come from Specter's only `location.reload()` call; it also occurs on `main` and remains unexplained.

The final Chromium live-CodePen attempt reached Cloudflare's security-verification page, not the result iframe. That external check is blocked by the test environment; it is not a passing result. Chromium's local lifecycle and UI checks passed independently.

## Visual system

The active direction is **uBlock Origin layout in a T3 Code skin**, documented normatively in `DESIGN.md` and `.impeccable/design.json`. It replaced Chromatic Registration in schema 3; `migrateSettings` moves the untouched old defaults (`#007c91` accent, Ubuntu font) to the new defaults (`#1b4ed8`, system font) and keeps custom choices.

- Colors, radius, shadows, and easing come from T3 Code's shipped stylesheet. Dark mode is true black.
- The popup (360px) has a hostname, a round power button for the current tab, counters, scope tiles, the site pause action, and a bottom tool row.
- The dashboard has a sticky toolbar plus a horizontal tab strip. It becomes single-column at `860px`, and the toolbar wraps at `640px` while tabs scroll horizontally.
- Motion: 150ms standard transitions, opacity/98% scale entrances, drawer-curve toasts, stepped status pings and skeletons, and a shine while busy. Reduced motion and forced colors are first-class.
- `styles/theme.js` clamps custom accents against the `SURFACES` list and prefers white ink at 4.5:1 or better.
- Icons are inline SVG. The grain and select chevron are data URIs. Barlow Condensed and the raster stock texture were removed.

Preserve explicit state words so color is never the sole signal.

## Verification gates

Use the normal toolchain when available:

```text
npm test
npm run build
```

`npm test` validates the manifest, local assets/licenses, HTML IDs, JavaScript syntax, policy behavior, lifecycle semantics, Firefox bridge behavior, and deterministic archive packaging. `npm run build` repeats the suite and produces both archives.

For UI changes, run `node tests/browser-ui.cjs` with Playwright and its Chromium binary installed in the development environment. This optional suite checks drafts, save/discard, search, pagination, section links, themes, responsive widths, popup pause/resume, and unsupported-page state. Set `SPECTER_CAPTURE=1` to save screenshots under `.codex-qa/revision-review`; set `SPECTER_LIVE_CODEPEN=1` to include the external CodePen iframe sequence. The default UI suite uses only a local test page. Playwright is a test dependency, not an extension runtime dependency.

The September 6 screenshots were visually reviewed at popup width and 390, 1100, and 1440px settings widths, including light/dark and paused/unsupported states. Automated overflow checks also covered 720px. Impeccable's single manual scan ran in degraded regex mode because its parser dependencies were unavailable. Its design-token advisories and intentional CMY rail warnings are not a clean accessibility audit; palette contrast has separate automated coverage.

If the environment lacks Git, Node, npm, or Python on `PATH`, discover the environment-provided runtimes instead of editing project scripts around the host. On the original Windows checkout, Git may require `-c safe.directory=D:/Coding/Specter` because of ownership metadata.

Apply these additional gates by change type:

| Change | Required proof |
| --- | --- |
| Policy, main-world hooks, bridge, fullscreen, or tab state | Automated suite plus Chromium and Firefox-family repeated-toggle E2E; use exact CodePen for focus/tab changes. |
| Manifest or Firefox floor | Both archive manifests, Firefox data declaration, package tests, and live load in each target family. |
| Popup/options/overlay | Visual inspection at popup width, desktop, `<=980px`, `<=600px`, light, and dark; keyboard focus and reduced motion; no console errors. |
| Fonts, textures, icons, licenses | Validation plus confirmation that both archives contain the assets and notices. |
| Stored settings | Migration/fallback tests and an import/export round trip. |
| Release | Clean intended diff, synchronized version/changelog, full build, tag/workflow status, and downloaded public archive inspection. |

## Release and contribution rules

`.github/workflows/release.yml` runs on `v*`, builds with Node 22, and creates a GitHub release containing both browser archives. A local ZIP or pushed tag alone is not a verified release. Inspect the completed workflow, public release page, and downloaded contents.

Use focused commits. For material Codex-authored work, include:

`Co-authored-by: Codex <codex@openai.com>`

This trailer attributes the commit to Codex without rewriting published history. GitHub contributor display depends on GitHub's account and email matching; the trailer does not guarantee a profile in the contributor graph. Keep credentials and single-use authorization values out of files, logs, commit messages, and agent context.

## Known limits

- Browser-internal and extension-store pages block injection.
- A website may observe signals outside the visibility, focus, activity, and fullscreen surfaces Specter controls.
- Permanent installation in Firefox derivatives may require vendor signing.
- Browser shortcut conflicts can leave a command unassigned; Diagnostics must report the browser's actual assignment.
- Headless Chromium can disable Manifest V3 extensions, so direct package acceptance plus a real browser E2E is stronger evidence than profile metadata alone.
