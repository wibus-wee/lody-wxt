# Project contracts

Use pnpm and preserve the lockfile.
Runtime type checks use TypeScript 7's `tsc`; the `typescript` package alias supplies the legacy compiler API for ESLint.

Never write unit tests for web components.
Verify rendered behavior through Cucumber/Playwright, axe and Storybook.
Vitest Browser Mode is scoped to non-component infrastructure.

WXT entrypoints only mount surfaces or register browser lifecycle listeners.
Feature modules own behavior.
The independent SDK lives in `packages/lody-sdk`; its domain and application layers do not depend on React, WXT or device storage.
SDK requests use explicit origins and credentials.
Keep protocol failures visible; do not substitute data, endpoints or successful results.
Feature adapters own credentials, drafts and submission journals.
Reuse a submission's request ID when resolving uncertain delivery.
Keep Node-only tooling in `tools`.
All application UI controls use Lody's component library in `vendor/lody/packages/ui` through `src/shared/ui`.
Use StyleX for layout composition; do not build separately styled native controls or add a third-party styled UI library.
Keep the Lody submodule tracking `main` through `pnpm ui:update`; never force over upstream checkout changes.
Runeicons stays pinned.

Use StyleX for styles, Motion springs for interaction feedback and system Reduce Motion for animation and shader policy.
Icons inherit the global Jotai mood.
Add glyphs to the generator rather than editing generated SVG data or the submodule checkout.

New Gherkin scenarios must declare a registered `namespace`, a `journey`, state tags and transition tags where applicable.
Derive multi-link journey obligations from product state owners in `tools/assurance/model.mjs` before writing scenarios.
Declare the model case and assert every obligation in the same attempt.
Regenerate `tests/e2e/namespaces.json` from the model when adding a namespace; tests do not own the coverage denominator.
Author interaction start/end boundaries in the model; retain environment, traces and explicit baseline provenance.
Regenerate `COVERAGE.md` from real reports; never hand-edit evidence.

Run `pnpm check` and the browser tests affected by a change.
Run `pnpm test:extension` for storage, routing, CSP or packaged-entrypoint changes. `pnpm run doctor` runs React Doctor; `pnpm doctor` is pnpm's own diagnostic command.
