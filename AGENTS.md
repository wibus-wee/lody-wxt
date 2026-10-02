# Project contracts

Use pnpm and preserve the lockfile.
Runtime type checks use TypeScript 7's `tsc`; the `typescript` package alias supplies the legacy compiler API for ESLint.

Never write unit tests for web components.
Verify rendered behavior through Cucumber/Playwright, axe and Storybook.
Vitest Browser Mode is scoped to non-component infrastructure.

WXT entrypoints only mount surfaces or register browser lifecycle listeners.
Feature modules own behavior.
Keep Node-only tooling in `tools`.
Lody's own component library lives in `vendor/lody/packages/ui` and belongs behind `src/shared/ui`; do not add a third-party styled UI library.
Keep the Lody submodule tracking `main` through `pnpm ui:update`; never force over upstream checkout changes.
Runeicons stays pinned.

Use StyleX for styles, Motion springs for interaction feedback and system Reduce Motion for animation and shader policy.
Icons inherit the global Jotai mood.
Add glyphs to the generator rather than editing generated SVG data or the submodule checkout.

New Gherkin scenarios must declare a registered `namespace`, a `journey`, state tags and transition tags where applicable.
Update `tests/e2e/namespaces.json` when adding a feature namespace.
Regenerate `COVERAGE.md` from real reports; never hand-edit evidence.

Run `pnpm check` and the browser tests affected by a change.
Run `pnpm test:extension` for storage, routing, CSP or packaged-entrypoint changes. `pnpm run doctor` runs React Doctor; `pnpm doctor` is pnpm's own diagnostic command.
