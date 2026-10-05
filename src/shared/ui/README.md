# UI integration

This directory is the adapter boundary for Lody's own `@lody/ui` component library.
Its source is [`vendor/lody/packages/ui`](../../../vendor/lody/packages/ui), from the [Lody repository's main branch](https://github.com/LodyAI/Lody/tree/main/packages/ui).
Application controls consume the upstream source through the modules here: Button, Input, Textarea, Select, Card, Dialog, Field, Switch, Badge, Alert and Collapsible.
These modules preserve upstream APIs.
Component props own appearance; application StyleX classes compose layout.
Native elements provide document structure and text, while Lody components own controls and styled surfaces.
The [conversation adapter](./conversation/README.md) owns ordered assistant items, official activity groups and per-segment work folding.

| Concern                      | Owner                                                             | Consumer                             |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| Component API and appearance | Lody's `@lody/ui`, adapted through this directory                 | Application features                 |
| Component tokens             | [`vendor UI tokens`](../../../vendor/lody/packages/ui/src/tokens) | Upstream component styles            |
| Mood-aware icons             | [`../icons/Icon.tsx`](../icons/Icon.tsx)                          | Application header and your controls |

Agent controls use [AgentIcon](./AgentIcon.tsx) and the public identity projected by [agent-identity](../icons/agent-identity.ts).
The resolver follows Lody’s AgentIcon rules and reuses its provider-brand resolver; model names never determine the logo.
Codex uses OpenAI, Claude uses Anthropic, provider presets override builtin logos, registry agents use their registered SVG, and custom agents use a terminal.
Machine controls use a device glyph.
Only the resolved brand crosses into the UI, without agent environment variables.
Agent menu rows set `Menu.RadioItem`'s `indicatorSide="end"`; the default leading indicator replaces the `icon` slot.

The [icon generator](../../../scripts/generate-icons.mjs) reads Lody’s brand and registry assets on each UI refresh.
Brand marks retain their canonical shape; interface glyphs follow the global Jotai mood, fixed to outline by the preferences model.
MiMo uses the [Xiaomi source asset](../../../tools/icons/xiaomi.svg) matching upstream’s Simple Icons mark.

Git submodules target repositories, not subdirectories, so `vendor/lody` checks out the whole repository.
The submodule tracks `main`; [`scripts/sync-ui.mjs`](../../../scripts/sync-ui.mjs) fetches its latest commit before installation preparation, development servers, builds, packaging and Storybook.
Run `pnpm ui:update` to refresh it explicitly and regenerate the icon assets.
An unchanged `pnpm install` may skip lifecycle scripts; use `pnpm prepare` or `pnpm ui:update` to refresh without starting a server.
Runeicons is not updated by this command.

Each refresh uses the latest fetched `origin/main` at that moment, not continuous background polling.
Git still records a concrete gitlink; refreshes can leave `vendor/lody` modified in the parent repository.
Commit that pointer when recording a new baseline.
Updates stop on local submodule changes or a fetch failure; they never force a checkout or silently use a stale revision.
Git access to `LodyAI/Lody` is required.
Project lint and format commands disable nested configurations so the upstream's tooling cannot override the `vendor` exclusions.

Run `node tools/ui/build.mjs` after refreshing upstream and before typechecking, development or builds.
The [UI build configuration](../../../tools/ui/tsconfig.json) checks the consumed upstream modules with the library's strict compiler contract and emits declarations into ignored `dist/lody-ui`.
It also generates JavaScript entrypoints that re-export the original vendor source, so Vite still compiles upstream StyleX and React code.
The modules here import those entrypoints; application TypeScript reads their matching declarations and retains its own `exactOptionalPropertyTypes` checks.
The build removes previous output and stops on declaration errors, keeping upstream implementation checks separate from application contracts.
Add each new upstream entrypoint to the UI build configuration before exposing it here.
Keep behavior, storage and routing inside their current feature owners.
Cover changed UI through browser journeys and Storybook, never component unit tests.
