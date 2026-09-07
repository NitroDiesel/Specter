# Specter agent instructions

Read [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md) before continuing prior work or changing architecture, browser behavior, compatibility, UI, packaging, or releases. It records the current handoff, invariants, verification gates, and unpublished work.

Use these sources of truth:

- [`PRODUCT.md`](PRODUCT.md) for product scope and durable behavior.
- [`DESIGN.md`](DESIGN.md) for the implemented visual system.
- `manifest.json`, `package.json`, and the code for current executable truth.

Before editing, inspect the branch and working tree. The checkout may contain the validated but uncommitted Chromatic Registration redesign; preserve it and all unrelated user changes.

Keep these invariants:

- Main-world hooks load statically at `document_start`, before the isolated bridge, in every supported frame and opaque child origin.
- Live global, site, and tab changes apply without a page reload where supported. Listener removal, `once`, abort signals, and extension-world observers continue to work.
- `manifest.json` is the Chromium source manifest. The build creates a Firefox-family archive by converting only the background declaration.
- Runtime assets remain local and compatible with the extension CSP. Preserve stored settings or provide a migration.
- Browser behavior changes require the automated suite plus repeated protected → disabled → re-enabled checks on the affected browser. Tab/focus regressions also require the exact CodePen page documented in the handoff.
- A release is complete only after version files, changelog, both archives, target manifests, tag, workflow, and public assets are verified.

Do not claim local work is committed, merged, released, or deployed without checking. Do not commit, push, merge, tag, or publish unless the user requests it. Add `Co-authored-by: Codex <codex@openai.com>` to material Codex-authored commits.
