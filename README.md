# Lody for Chrome

A compact Lody side panel for conversations with workspace / machine / Agent execution targets and explicitly attached webpage context.
The runnable first release is **demo-production**: local history, streaming, cancellation and retry work in the packaged MV3 extension.
Real account access remains a deliberate integration boundary, not a model-API wrapper or an implicit mock fallback.

## Run

Requires Node 26, pnpm 12 and access to both submodules.

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm build
```

In `chrome://extensions`, enable Developer mode and load `.output/chrome-mv3`.
Click Lody's toolbar button → **打开侧栏**.
Create a conversation, open an ordinary webpage, attach the page or selected text, then send.
Chrome requests access to that site when necessary.
Stop retains received text; reopening restores history and drafts.
The attachment menu includes **演示：下一次发送失败** to exercise retry.

Use **打开设置** for connection mode, workspace ID, system/light/dark theme, five icon moods, optional GitHub project matching and ambient effects.
Demo project matching consults a synthetic machine directory containing `LodyAI/lody`; it does not inspect your real machine.

`pnpm dev` launches WXT's development extension. `pnpm dev:web` serves the same app at `http://127.0.0.1:4173`; the preview cannot read other tabs and offers an explicitly labeled demo attachment instead.
Chrome side-panel support is the release target; Firefox scripts are retained but not a supported side-panel release.

## Runtime map

| Area          | Owner                                                      | Contract                                                                          |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Entrypoints   | [src/entrypoints](./src/entrypoints)                       | Mount popup, options and side panel; register worker lifecycle                    |
| Chat          | [features/chat](./src/features/chat)                       | Streaming UI, safe Markdown, copy, IME, scroll following, per-session drafts      |
| Conversations | [features/conversations](./src/features/conversations)     | History, new session and execution-target flow                                    |
| Page context  | [features/page-context](./src/features/page-context)       | Gesture-only capture, bounded visible text, removable source previews             |
| Connection    | [connection contract](./src/features/connection/README.md) | Typed client, demo transport and fail-closed real integration boundary            |
| UI            | [shared UI](./src/shared/ui/README.md)                     | Actual `@lody/ui` workspace source, component themes and build contract           |
| Build         | [tools/vite/plugins.ts](./tools/vite/plugins.ts)           | Shared WXT / web / Storybook source compilation and CSS extraction                |
| Verification  | [tests](./tests), [COVERAGE.md](./COVERAGE.md)             | Browser infrastructure, Cucumber + axe, packaged MV3 tests and generated evidence |

React Query owns async preferences and conversation snapshots; Jotai owns active session, drafts and UI state, keyed by account and session.
The worker serializes demo commands and persists stream chunks, so closing the panel does not depend on a mounted component.
If Chrome terminates the worker, the next load marks interrupted output stopped rather than pretending it completed.
Operations are idempotent across worker restarts.

Extension storage uses `browser.storage.local`: `preferences`, `chat-ui:v1`, and `demo:workspace:history:v1`.
Web preview uses the same keys prefixed `lody:` in its own origin's localStorage.
Demo history is limited to 100 conversations / 100 turns per conversation, messages to 16,000 characters and attachments to three × 12,000 characters.
These are local, unencrypted demonstration data; do not use them for secrets.
No browsing history or page content is automatically uploaded.
Real account queries use separate keys and never read demo history.

## Connection and permissions

**演示模式** is always visible. **真实 Lody（待集成）** shows an explicit blocker and disables sending; connection failure never silently returns demo data.
Upstream browser streams and MCP have different authentication and lifecycle requirements.
The [connection contract](./src/features/connection/README.md) records the inspected interfaces and the remaining authorization / directory / session / subscription work.
No secret, endpoint guess or desktop credential access is bundled.

The release requests storage, sidePanel, activeTab, scripting and tabs. `tabs` exposes current-tab metadata needed when the side-panel gesture lacks an action's activeTab grant; no tab/history listeners are registered.
Optional HTTP/HTTPS host access is requested for the current origin only after attachment.
There is no default `<all_urls>` grant or automatic content script.
Chrome internal pages and restricted sites report an error.
Captured text excludes forms, editable fields, hidden content and obvious navigation; URLs omit credentials, query strings and fragments.
Page text is always typed as untrusted reference material, not system instructions or tool authorization.
A heuristic extractor is not a universal sensitive-data classifier: review the preview before sending.

Markdown never renders raw HTML or external images; only HTTP(S) links survive.
The release does not perform autonomous clicks, file writes or permission approval.
Real cancellation is unavailable until supported by the authenticated adapter; only local demo cancellation is currently advertised.

## Toolchain and verification

| Command                                                | Purpose                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm check`                                           | Strict TypeScript 7, Oxlint, ESLint, Oxfmt and Knip                                    |
| `pnpm test:browser`                                    | Non-component infrastructure in Chromium with V8 coverage                              |
| `pnpm test:e2e`                                        | Cucumber / Playwright / axe; checks isolated port 4273 before starting                 |
| `pnpm test:extension`                                  | Rebuild and load the actual MV3 extension; worker, side panel, context and permissions |
| `pnpm build`, `pnpm build:web`, `pnpm build:storybook` | Production extension, preview and component-source stories                             |
| `pnpm coverage:generate`                               | Real-report Journey Graph, State-Fusion Matrix and Namespace Disposition               |
| `pnpm storybook`                                       | Sidebar, settings and popup stories on port 6006                                       |
| `pnpm ui:update`                                       | Fetch latest Lody `main` without overwriting upstream changes; Runeicons stays pinned  |
| `pnpm run doctor`                                      | React Doctor (`pnpm doctor` is pnpm's unrelated diagnostic)                            |
| `pnpm dev:docs`, `pnpm dev:tools`                      | Fumadocs on port 4000 and Node-only Devframe RPC                                       |

Install Chromium with `pnpm exec playwright install chromium`.
Override the isolated E2E port using `LODY_E2E_PORT`; occupied ports fail rather than reusing another app.
Headless Chrome auto-accepts site prompts, so the refusal test substitutes only the permission decision; successful capture uses Chrome's real site-access settings, unmodified scripting and packaged code.

Never write component unit tests.
Storybook, browser journeys and axe verify rendering; Vitest Browser Mode only exercises non-component infrastructure.
Coverage reports do not equate line percentages with product coverage.
Existing workflows remain manual `workflow_dispatch` only.

WXT / Vite retain OXC and React Compiler; the `@typescript/native` alias runs TypeScript 7, while `typescript` supplies the legacy compiler API for ESLint.
Motion springs respect system Reduce Motion.
Optional Paper shaders are lazy and disabled under Reduce Motion.
Runeicons inherit global Jotai mood; add glyphs to the [generator](./scripts/generate-icons.mjs), not generated assets.
React Scan / Grab remain opt-in development tools and are absent from release bundles.

See [architecture](./docs/content/architecture.mdx), [testing](./docs/content/testing.mdx) and [interaction](./docs/content/design.mdx) for extension points.
