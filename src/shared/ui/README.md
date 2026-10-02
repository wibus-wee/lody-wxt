# UI integration

This directory is the adapter boundary for Lody's own `@lody/ui` component library.
Its source is [`vendor/lody/packages/ui`](../../../vendor/lody/packages/ui), from the [Lody repository's main branch](https://github.com/LodyAI/Lody/tree/main/packages/ui).
The starter uses native elements and one unstyled Base UI switch.

| Concern                      | Owner                                                    | Consumer                             |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------ |
| Component API and appearance | Lody's `@lody/ui`, adapted through this directory        | Application features                 |
| Shared tokens                | [`../theme/tokens.stylex.ts`](../theme/tokens.stylex.ts) | StyleX component styles              |
| Mood-aware icons             | [`../icons/Icon.tsx`](../icons/Icon.tsx)                 | Application header and your controls |

Git submodules target repositories, not subdirectories, so `vendor/lody` checks out the whole repository.
The submodule tracks `main`; [`scripts/sync-ui.mjs`](../../../scripts/sync-ui.mjs) fetches its latest commit before installation preparation, development servers, builds, packaging and Storybook.
Run `pnpm ui:update` to refresh it explicitly.
An unchanged `pnpm install` may skip lifecycle scripts; use `pnpm prepare` or `pnpm ui:update` to refresh without starting a server.
Runeicons is not updated by this command.

Each refresh uses the latest fetched `origin/main` at that moment, not continuous background polling.
Git still records a concrete gitlink; refreshes can leave `vendor/lody` modified in the parent repository.
Commit that pointer when recording a new baseline.
Updates stop on local submodule changes or a fetch failure; they never force a checkout or silently use a stale revision.
Git access to `LodyAI/Lody` is required.
Project lint and format commands disable nested configurations so the upstream's tooling cannot override the `vendor` exclusions.

Adapt the upstream components here before replacing controls in `src/app/App.tsx`.
The submodule provides source only; it is not installed as a workspace dependency yet.
Keep behavior, storage and routing inside their current feature owners.
Cover changed UI through browser journeys and Storybook, never component unit tests.
