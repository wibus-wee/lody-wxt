# Lody UI integration

Features import the real `@lody/ui` primitives through [index.ts](./index.ts).
This file re-exports Button, Textarea, Input, Field, Select, Menu, Dialog, Popover, Tooltip, Alert, Badge, Spinner, Switch and ThemeRoot; it does not wrap, copy or imitate their implementation.
Appearance and interaction variants belong to the library; application StyleX owns surface layout.

| Concern                     | Owner                                                                                                                   | Integration                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Components and semantics    | [upstream package](../../../vendor/lody/packages/ui/package.json), [README](../../../vendor/lody/packages/ui/README.md) | `@lody/ui` is an actual pnpm workspace dependency using source exports                                             |
| Palette / system-light-dark | `@lody/ui/theme` and exported color tokens                                                                              | App ThemeRoot and library component palette themes                                                                 |
| Readable hints and feedback | [readable.stylex.ts](./readable.stylex.ts)                                                                              | Theme-token overrides, not local primitive styling                                                                 |
| Product composer            | [composer.ts](./composer.ts), [composer.stylex.ts](./composer.stylex.ts)                                                | Original Lody toolbar styles and product light/dark composer materials                                             |
| Product run configuration   | [RunConfigMenu.tsx](./RunConfigMenu.tsx), [MenuSearchInput.tsx](./MenuSearchInput.tsx)                                  | Copied Lody product menu structure with controlled extension state; actual library Menu / Switch semantics         |
| Product permission selector | [PermissionModeMenu.tsx](./PermissionModeMenu.tsx)                                                                      | Original icon-only permission trigger, option rows, description tooltips and warning glyph                         |
| Product transcript          | [MessageSurface.tsx](./MessageSurface.tsx), [MessageMarkdown.tsx](./MessageMarkdown.tsx)                                | Copied user/assistant row layout, process disclosures, turn actions and Markdown/code surfaces                     |
| Source compilation / CSS    | [shared plugins](../../../tools/vite/plugins.ts), upstream `stylex-options.ts`                                          | WXT, Vite and Storybook use identical library transform options and extracted production CSS                       |
| TypeScript boundary         | [tools/ui](../../../tools/ui)                                                                                           | TypeScript 7 emits declarations for upstream's own strict contract; application keeps `exactOptionalPropertyTypes` |
| Icons                       | [Icon.tsx](../icons/Icon.tsx), [generator](../../../scripts/generate-icons.mjs)                                         | Pinned Runeicons and global Jotai mood                                                                             |

The workspace catalog supplies upstream development dependencies.
Overrides align StyleX / its transform and Base UI versions; Vite deduplicates React, React DOM, StyleX and Base UI.
The UI package is not dependency-prebundled because its StyleX source must be transformed.
Its Base UI dependency is explicitly prebundled for CommonJS compatibility.
Production injects no runtime StyleX styles: CSS is extracted into emitted assets.
In development, the [StyleX bridge](../../../tools/vite/stylex-dev.ts) resolves stylesheet and runtime URLs against WXT's Vite server rather than the extension origin.
Runtime CSS refreshes use the importing module's server origin, including styles compiled by lazy imports.
The [development extension journey](../../../tests/extension/dev-stylex.spec.ts) checks all three packaged surfaces and a late StyleX import against the real extension origin.

The [chat composer](../../features/chat/Composer.tsx) ports the structure and dimensions of Lody's [ChatComposer](../../../vendor/lody/packages/components/src/components/chat/chat-composer.tsx): a bare Textarea above a single toolbar, with attachment tiles inside the frame.
Toolbar triggers reuse Lody's [composerSurface](../../../vendor/lody/packages/components/src/components/shared/composer-surface.ts) directly through this boundary; their labels collapse through its container query in narrow sidebars.
The material tokens match Lody's product palettes and support system or explicitly selected light/dark themes.
The transcript scrolls independently above the docked composer.
The [message adapter](../../features/chat/MessageView.tsx) maps durable turn data into `MessageSurface`, ported from Lody's [ai-gui view](../../../vendor/lody/packages/components/src/components/ai-gui/view.tsx): `UserMessageRowView`, `UserPlainTextBlock`, `AssistantTurnFooter`, `ProcessDisclosureButton` and `WorkedGroupHeader`.
User attachments precede the text bubble; long prompts fold at 10 lines or 900 characters with a 160px height cap.
Assistant rows are avatar-free, with one 4px content rail, hover/focus actions and accepted-turn configuration rather than live draft values.
Completed work folds only when an answer exists; streaming and interrupted tool-only turns remain expanded.
The detail sheet ports [tool-call-detail.tsx](../../../vendor/lody/packages/components/src/components/ai-gui/tool-call-detail.tsx) material and sections without a duplicate header.
The Markdown surface ports [markdown-renderer.tsx](../../../vendor/lody/packages/components/src/components/ai-gui/markdown-renderer.tsx), [markdown-code-block.tsx](../../../vendor/lody/packages/components/src/components/ai-gui/markdown-code-block.tsx) and their [CSS](../../../vendor/lody/packages/components/src/tailwind/index.css): text roles, list markers, table scrollers, fence toolbars, wrapping, copy feedback and Markdown preview.
Its local worker directly reuses upstream's pure [markdown-highlighter.ts](../../../vendor/lody/packages/components/src/lib/markdown-highlighter.ts) with its JavaScript regex engine; it requires no remote scripts or WASM CSP relaxation.
The [WXT configuration](../../../wxt.config.ts) selects the [extension worker factory](./create-extension-code-worker.ts), which starts the [WXT worker entrypoint](../../entrypoints/markdown-highlight.ts) through `browser.runtime.getURL`, in both development and production.
The worker's main script must remain on the extension origin: Chromium terminates the renderer for a cross-origin dedicated worker, even when development CSP allows the Vite server.
Web and Storybook previews retain the [Vite worker factory](./create-code-worker.ts); the extension build excludes this web-only worker rather than packaging a second highlighter.
The Vite factory also detects extension pages before constructing a worker, protecting running development servers whose alias configuration has not yet restarted.
Both entrypoints register the same [highlighting handler](./markdown-highlight.ts).
The [development extension regression](../../../tests/extension/dev-stylex.spec.ts) restores code-bearing history, checks the worker's extension URL and highlighted spans, and keeps copy/wrap controls usable across reloads.
The [syntax palette](./message.tokens.stylex.ts) preserves upstream light/dark hues, with darker light constants, links and captions to meet AA on the code-fence surface.
Raw HTML, remote images and unsupported links remain inert in webpage-derived replies.
Message timestamps and activity records are optional, bounded history fields; legacy rows remain readable without invented metadata.
The demo runtime records real local turn times but does not fabricate tool events.
Rich history fixtures are explicitly labelled demonstrations and exercise production rendering in [Cucumber](../../../tests/e2e/features/chat.feature) and [Storybook](../../features/chat/MessageView.stories.tsx).
The run-config menu copies Lody's [DesktopRunConfigMenu](../../../vendor/lody/packages/components/src/components/sessions/desktop-run-config-menu.tsx) option rows, value submenus, persistent toggle rows and compact model / reasoning face.
The adjacent permission menu copies `DesktopPermissionModeButton` from that same source: a 28px icon-only trigger, flat choice rows with a trailing check, description tooltips and a warning-colored glyph for Full access.
Selection closes the menu and restores composer focus.
Both the selected mode and its visible title restore with the draft; accepted turns freeze the mode with the other configuration.
The demo catalog copies Codex's `CODEX_STATIC_MODES` from [shared ai.ts](../../../vendor/lody/packages/shared/src/ai.ts); selecting one in the demo never grants execution authority.
The search field copies the product [MenuSearchInput](../../../vendor/lody/packages/components/src/ui/menu.tsx) keyboard policy and reuses the original menu styles and fuzzy scorer.
Runeicons replaces desktop Lucide glyphs to preserve the extension's global mood contract.
Desktop stores, analytics and provider hooks are replaced with controlled feature props; upstream files remain unchanged.
The visual switch is inert inside its actionable menu row.
[SearchableMenuContent](./SearchableMenuContent.tsx) adapts Lody's Menu.Content assembly using the same pinned Base UI dependency and original surface styles: the popup is a search dialog containing a named menu of choices, so a textbox is not an invalid child of a menu.
The search shell is a named fieldset, and a no-results state replaces the empty choices menu with a status.
Search placeholders use the semantic secondary-label color for readable small text.
The [client capability catalog](../../features/connection/run-config.ts) supplies model-specific reasoning and mode availability.
Its demo fixture is not live provider discovery and never calls real models.
Draft configuration is account/session-scoped; each accepted turn freezes it in durable history, and retry uses the failed turn's configuration rather than the edited draft.
Unavailable real connections expose no demo model catalog.
Page context remains read-only and never grants tool authority.
Its disclosure belongs to the below-composer context hint, not the Agent permission control, and also identifies the execution target.

The reset layer must precede Lody's StyleX layers in the shared compiler options, including development injection.
Otherwise browser resets override component typography and input spacing despite the generated classes being present.

The app's declaration boundary handles two upstream source incompatibilities with `exactOptionalPropertyTypes`: Dialog passes a possibly undefined `className`, and Menu forwards a possibly undefined `tone`.
Upstream declares optional props without an explicit undefined member.
The minimal upstream change would omit those properties when undefined (or intentionally include undefined in their public types).
No vendor source was changed.
Generated declarations resolve Base UI's types from the UI workspace, so this is not an `any` stub or a reduction in the application's strictness.

Actual axe checks also found small hint / placeholder text and tinted Alert descriptions below AA contrast.
Product themes use semantic secondary-label tokens for hints and placeholders and label tokens for feedback, preserving library geometry, variants and palette.
Feedback tokens currently lack a package export, so only this shared boundary imports that token source directly.
A minimal upstream improvement is to export feedback tokens and adopt accessible text colors; consumers need no copied components.

`vendor/lody` tracks `main` through [sync-ui.mjs](../../../scripts/sync-ui.mjs).
Install preparation, development and builds fetch the latest commit; `pnpm ui:update` refreshes explicitly.
The gitlink records the chosen baseline.
Dirty upstream checkouts and fetch failures stop the update; they are never overwritten or silently ignored.
Runeicons is not refreshed.
Nested upstream lint/format configs cannot override the repository's vendor exclusions.

Test API and behavior changes through browser journeys and Storybook, never component unit tests.
Library updates must pass `pnpm check` and all affected builds and browser journeys.
