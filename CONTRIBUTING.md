# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Before opening a pull request

1. Create a focused branch from `main`.
2. Keep extension runtime code dependency-free unless a dependency has a clear security and maintenance case.
3. Preserve Chromium and Firefox compatibility.
4. Add or update tests for behavior changes.
5. Run `npm test` and `npm run build`.
6. Describe user-visible behavior, permissions changes, and manual verification in the pull request.

## Interface changes

Use the shared tokens and components in `styles/`. Keep the popup focused on active-tab tasks and place deeper configuration in the options page. Verify light, dark, narrow, and desktop layouts.

## Security and privacy

Do not add telemetry, remote scripts, remote fonts, or new permissions without explicit discussion. Never include exported settings, browsing data, credentials, signing keys, or generated extension packages in a pull request.

Security-sensitive reports should follow [SECURITY.md](SECURITY.md), not the public issue tracker.
