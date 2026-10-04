# Lody WXT

Lody browser extension built with WXT and Vite 8, with an independent TypeScript SDK.
The popup, side panel, options page and browser preview share one application; Lody's own `@lody/ui` is the component-library source behind the shared UI boundary.

| Area            | Entry                                                                                                  | Responsibility                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Extension       | [`src/entrypoints`](./src/entrypoints)                                                                 | Popup, options and MV3 background worker                                           |
| Application     | [`src/app`](./src/app)                                                                                 | React Query, Jotai, hash routing and spring motion                                 |
| Features        | [`src/features`](./src/features)                                                                       | Account lifecycle, conversation submission journals, page context and preferences  |
| SDK             | [`packages/lody-sdk`](./packages/lody-sdk)                                                             | Protocol adapters and domain use cases independent of React and Chrome             |
| Structural lint | [`rules`](./rules), [`sgconfig.yml`](./sgconfig.yml)                                                   | Sorbet ast-grep rules enforced for TypeScript and TSX                              |
| Lody UI         | [`vendor/lody/packages/ui`](./vendor/lody/packages/ui), [`src/shared/ui`](./src/shared/ui/README.md)   | Own component-library source tracking upstream `main`; local adapter boundary      |
| Icons           | [`vendor/runeicons`](./vendor/runeicons), [`scripts/generate-icons.mjs`](./scripts/generate-icons.mjs) | Pinned fork and global five-mood SVG adapter                                       |
| Documentation   | [`docs`](./docs)                                                                                       | Fumadocs MDX + Core on Vite, with native HTML presentation                         |
| Developer tools | [`tools/devframe`](./tools/devframe)                                                                   | Read-only Devframe RPC for coverage and metadata                                   |
| Verification    | [`tests`](./tests), [`COVERAGE.md`](./COVERAGE.md)                                                     | Real browser infrastructure checks, Cucumber journeys and packaged extension tests |

## Start

Requires Node 26 and pnpm 12.
The lockfile pins dependencies; TypeScript 7 runs strict checks through the `@typescript/native` alias.
The `typescript` alias supplies the TS6 API for ESLint and tooling that requires the older compiler API, following [Microsoft's side-by-side installation](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).

```sh
git submodule update --init --recursive
pnpm install
pnpm dev
```

WXT launches a browser with the extension loaded.
For a browser preview without extension APIs, run `pnpm dev:web` and open `http://127.0.0.1:4173`.
Load `.output/chrome-mv3` from Chrome's extension developer mode after `pnpm build`.

| Command                                                     | Result                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`, `pnpm dev:firefox`                              | WXT development in Chrome or Firefox                                                     |
| `pnpm dev:web`                                              | Shared app on port 4173                                                                  |
| `pnpm dev:docs`                                             | Fumadocs on port 4000                                                                    |
| `pnpm storybook`                                            | Stories on port 6006; accessibility addon enabled                                        |
| `pnpm build`, `pnpm build:firefox`, `pnpm zip`              | Packaged extension outputs                                                               |
| `pnpm build:web`, `pnpm build:docs`, `pnpm build:storybook` | Production preview, docs and stories                                                     |
| `pnpm check`                                                | Strict TypeScript 7, ast-grep rule tests and scan, Oxlint, Hyoban ESLint, Oxfmt and Knip |
| `pnpm test:sdk`, `pnpm test:sdk:package`                    | SDK protocol tests and independent tarball JS/TS consumer verification                   |
| `pnpm test`                                                 | Vitest Browser Mode, Cucumber + Playwright + axe, packaged extension integration         |
| `pnpm coverage:generate`                                    | Evidence-based journey graph, state fusion and namespace disposition                     |
| `pnpm run doctor`                                           | React Doctor diagnostics                                                                 |
| `pnpm dev:tools`                                            | Local authenticated Devframe RPC runtime                                                 |
| `pnpm ui:update`                                            | Fetch and check out the latest Lody `main`; leave Runeicons pinned                       |

Install Chromium once with `pnpm exec playwright install chromium`.
The E2E runner owns port 4173; stop `dev:web` before running it.
Web component unit tests are prohibited; browser journeys verify UI behavior.
Vitest only tests storage/state infrastructure in a real browser.

## Runtime and extension points

WXT, web preview and Storybook share [`tools/vite/plugins.ts`](./tools/vite/plugins.ts).
Vite performs OXC transforms, the official React Compiler preset compiles eligible React code, and StyleX extracts CSS.
No third-party styled component library is installed.
Application UI uses Lody's own components through [`src/shared/ui`](./src/shared/ui/README.md); feature styles compose layouts.
That boundary documents the source location, automatic refresh policy and upstream checkout protections.

Sign in to Lody and select a workspace.
The official application supplies service endpoints and its authentication client internally.
The SDK receives explicit configuration from the application; end users do not configure deployment addresses.
Feature adapters own account persistence and submission journals.
The SDK owns HTTP, Streams and CRDT protocols; feature controllers own identity changes, drafts and delivery recovery.
A submission receipt records delivery state, while agent output comes from the session history.
Retain each request ID when resolving uncertain delivery; starting a new request can create another conversation.
Production verification requires a deployed backend, workspace membership and an online configured machine.

React Query owns asynchronous preference loads and saves.
Jotai exposes current preferences to mood-aware icons and effects.
Extension pages use `browser.storage.local` and subscribe to storage changes; the web preview uses localStorage.
Failed writes retain the previous preferences and expose a retryable error.
Corrupted web storage falls back to defaults.

[Runeicons](https://github.com/Runeicons/runeicons) is pinned as a full-repository submodule because Git cannot submodule a directory.
The source package is `packages/runeicons`.
The asset generator extracts five home glyphs: outline → normal, pixel → pixelated; glass uses the separate glass collection.
Add named glyphs in the generator and consume them through the global mood adapter.
Keep the upstream Apache-2.0 license with distributed icons.

Motion defaults to springs and follows Reduce Motion.
Paper shaders are lazy, opt-in decoration and are disabled under Reduce Motion.
The introduction uses Cuelens' host-controlled steps without automatic playback.
Interaction defaults follow [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/); your library owns the final visual system.

React Scan and React Grab are opt-in development tools.
Copy `.env.example` to `.env`, then enable the desired flag.
Production builds remove the development import branches.
Devframe remains Node-only and is not shipped in the extension; see the [Devframe getting-started guide](https://devfra.me/raw/guide/getting-started.md).

Read the [architecture](./docs/content/architecture.mdx), [testing policy](./docs/content/testing.mdx) and [interaction guidance](./docs/content/design.mdx) before extending features.
The coverage generator reports missing evidence as “not run”; infrastructure percentages do not stand in for end-to-end product coverage.
