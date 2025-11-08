# Specter

Specter is a Material Design 3 browser extension that keeps tabs looking active by spoofing visibility and focus APIs. It blocks or fakes `visibilitychange`, `blur`, and `focus` events, randomises fake-user bursts, and logs everything locally so sites can’t tell when you switch away. This is still under development

## Highlights

- **Manifest V3** service worker with shared code for Chromium and Firefox (`browser_specific_settings` included).
- **Main-world spoofing bridge** that overrides `document.hidden`, `visibilityState`, `hasFocus`, and intercepts listeners via a custom injector at `document_start`.
- **Per-tab/per-site controls** with wildcard allowlist entries and optional expirations surfaced via the popup + options UI.
- **Fake activity + decoy timing** modules that dispatch synthetic focus/pointer bursts on smart intervals.
- **Heatmap + logging** with export/import (JSON + CSV) and maintenance controls; telemetry is disabled by default.
- **Material You interface** (popup + options) powered by local Roboto/Ubuntu fonts and bundled Material Symbols, plus offline seed-based palette generation.
- **Offline assets** only: icons, fonts, and tokens are shipped inside `assets/`, `fonts/`, and `styles/` with no remote requests.

## Directory layout

```
Specter/
├─ manifest.json              # MV3 definition shared by Chrome & Firefox
├─ background.js              # Service worker (storage, allowlist, badge, messaging)
├─ content.js                 # Isolated world bridge + fullscreen/pause overlay
├─ injected/main-world.js     # Main world overrides for visibility/focus APIs
├─ popup/                     # Compact popup UI (MD3)
├─ options/                   # Full options dashboard w/ theming + logs
├─ styles/                    # MD3 tokens, typography, icons, and base components
├─ assets/                    # Logos, icons, overlays
├─ fonts/                     # Roboto, Ubuntu, Material Symbols (woff2)
├─ scripts/build.js           # Creates specter-chrome.zip & specter-firefox.zip
├─ README.md / CHANGELOG.md / LICENSE
└─ specter-*.zip              # Build artifacts after running the build script
```

## Development

1. Load the unpacked extension (`Specter/`) in Chromium (chrome://extensions) or Firefox (about:debugging). Ensure “Allow access to file URLs” is enabled for local testing.
2. Use the popup for quick per-tab toggles. The options page offers deep controls, allowlist editing, fake activity tuning, tone palettes, exports, and maintenance utilities.
3. Fonts and icons are bundled locally—never reference remote CDNs when making UI adjustments. Extend `styles/md3-tokens.css` and `styles/base.css` for new tokens/components.
4. The injected script must stay dependency-free and run in the page context. Avoid importing libraries or using eval/dynamic imports.

## Browser support & known limitations

- **Chrome Developer Mode** – Recent Chrome builds ignore the `--load-extension` flag. To load Specter, open `chrome://extensions`, enable *Developer mode*, click **Load unpacked**, and choose the `Specter/` directory. The extension cannot display a notification before it is loaded, so these manual steps are required.
- **Chromium / Cromite** – Both browsers still honour command-line loading flags, so Specter can be preloaded via `--load-extension` for kiosks or automation.
- **Headless mode** – Chrome-family browsers currently disable MV3 extensions when started with `--headless`. Specter detects this scenario and records a diagnostic note, but the browser will not execute the service worker. For CI or scripted tests, run a normal (non-headless) instance.

## Building release zips

From the project root:

```bash
node scripts/build.js
```

This walks the tree (excluding `.git`, `.venv`, and previous zips) and produces `specter-chrome.zip` and `specter-firefox.zip` beside the manifest. Both archives contain the same payload; the Firefox upload leverages the `browser_specific_settings` block.

## Privacy & telemetry

Telemetry and logging are **off by default**. When enabled, data stays in `chrome.storage.local` only. The extension never reaches out to remote endpoints and all assets (fonts/icons) are bundled locally to ensure offline operation.

## License

Specter is released under the GPL-3.0 License (see `LICENSE`).
