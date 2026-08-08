# Specter

Specter is an open-source browser extension that keeps supported tabs looking active when you switch away. It controls page visibility and focus APIs, supports per-site exceptions, and stores optional activity logs locally.

The interface follows a current Google Material design language with light, dark, and system themes. Recommended mode keeps everyday settings concise; Advanced mode exposes injection, timing, and synthetic activity controls.

## Features

- Global and per-tab protection controls
- Time-limited or permanent site exceptions
- Optional local event log and site activity view
- Configurable focus-event handling, reload behavior, synthetic activity, and decoy timing
- JSON settings backup and restore, plus JSON/CSV event export
- Keyboard shortcuts for global and active-tab controls
- Local fonts, icons, and assets with no runtime CDN dependency

## Privacy

Specter has no analytics, advertising, accounts, or remote service. Settings, exceptions, and optional logs remain in browser extension storage. See [PRIVACY.md](PRIVACY.md) for the full data-handling statement.

## Install for development

### Chromium browsers

1. Download or clone this repository.
2. Open `chrome://extensions` (or the equivalent extensions page).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository folder.

### Firefox-family browsers

Specter supports desktop Firefox and maintained Gecko-based derivatives that implement compatible Manifest V3 WebExtensions, including current LibreWolf, Floorp, and Zen Browser releases when the browser permits user-installed extensions.

1. Run `npm run build` to create the Firefox-family packages.
2. Open `about:debugging#/runtime/this-firefox` (or the derivative's equivalent page).
3. Choose **Load Temporary Add-on**.
4. Select `specter-firefox.zip`. The supported Firefox-family package requires Gecko 152 or later.

Temporary installations are removed when the browser closes. Browsers that enforce Mozilla extension signing require a signed distribution build for permanent installation. Vendor restrictions, protected internal pages, and Tor Browser security policy still apply.

## Permissions

| Permission | Why Specter needs it |
| --- | --- |
| `storage` | Saves settings, site exceptions, and optional local logs. |
| `tabs` | Reads the active tab and applies per-tab protection state. |
| `scripting` | Injects the main-world script required to control page visibility and focus APIs. |
| `<all_urls>` | Makes protection available on supported web pages. Browser-internal and restricted pages remain unavailable. |

## Development

The project has no runtime or development package dependencies. Node.js and Python 3 are required for validation and release archives.

```bash
npm test
npm run build
```

`npm test` validates manifest references and licenses, checks HTML and JavaScript, exercises core protection policy, and verifies deterministic target-specific archives. `npm run build` additionally creates `specter-chrome.zip` and `specter-firefox.zip` from extension runtime files only.

The manual behavior suite is available at `tests/test-suite.html`. Load the unpacked extension first, enable file URL access, then open the suite in a supported browser.

## Project layout

```text
background.js          Service worker, settings, policy, and messaging
content.js             Isolated-world bridge and page lifecycle handling
injected/              Main-world visibility and focus overrides
popup/                 Fast active-tab controls
options/               Full settings application
styles/                Shared Material tokens, typography, icons, components
tests/                 Manual browser behavior suite
scripts/               Validation and release packaging
```

## Release process

1. Update `manifest.json`, `package.json`, and `CHANGELOG.md` to the same version.
2. Run `npm run build`.
3. Review the generated archives locally.
4. Merge the release PR into `main`.
5. Push a matching tag such as `v1.0.0`. The release workflow creates a GitHub release with both archives.

## Limitations

- Browser-internal pages and extension stores block content-script injection.
- Websites can use signals outside the visibility and focus APIs Specter controls.
- Extension behavior may conflict with a site's terms or expected operation; users are responsible for where they enable it.
- Headless Chromium commonly disables Manifest V3 extensions.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Specter is licensed under the [MIT License](LICENSE).
