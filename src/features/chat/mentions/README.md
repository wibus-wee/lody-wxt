# Composer mentions

The browser composer follows Lody's [source contracts](../../../../vendor/lody/packages/components/src/components/mentions/AGENTS.md) and [textarea interaction contracts](../../../../vendor/lody/packages/components/src/ui/mention/AGENTS.md). `/` and `、` merge available Agent commands with synchronized Prompt Shortcuts; `$` and `￥` discover provider-filtered skills; `@` opens source categories.
Browser tabs replace the desktop file source.
A session reference verifies readable history without switching the active conversation.

| Owner                      | Contract                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core.ts`                  | Trigger boundaries, range edits and frozen before-send expansion. Edited ranges lose their binding; bare typed tokens never resolve to an inferred session or path.                              |
| `menu-view.ts`             | Original category/namespace/direct-trigger routing; `/` merges commands and shortcuts, `@cmd:` and `@shortcut:` stay separate.                                                                   |
| `range-navigation.ts`      | Original atomic horizontal navigation and Backspace rules, independent of menu visibility.                                                                                                       |
| `use-composer-mentions.ts` | Caret replacement, keyboard/IME handling, per-opening source cache, version invalidation and cancellation when text, selection or target changes.                                                |
| `source.ts`                | Actual client capabilities, authorized session reads, skill discovery and browser page capture. Preparation returns data; the composer commits text, ranges and attached page together.          |
| `command-slash-search.ts`  | Port of Lody's canonical slash ranking, shared by commands and shortcuts.                                                                                                                        |
| `ComposerMentionMenu.tsx`  | Composer-anchored popup and mobile dock; candidate rows use the [shared MentionOption](../../../shared/ui/MentionOption.tsx) port of Lody's MentionItem. Back and retry actions use Lody Button. |

Up/Down and Home/End select candidates; Right/Tab enters categories, and Left/Backspace returns from an empty namespace.
The category header also provides a pointer/touch back action.
Shift+Tab dismisses without trapping focus; modified Enter and IME composition retain the composer's behavior.
Pointer movement highlights without keyboard scrolling, while touch uses the popup's single native scroll area.
The popup stays anchored to the composer; narrow viewports dock it above the frame and omit the detail pane.

Draft ranges retain the exact inserted text, frozen expansion and execution scope.
Collapsed carets snap to range boundaries, arrows cross the entire reference and Backspace removes it atomically; ordinary text selections retain native editing.
Sending to another target requires reselecting bound references.
Prompt Shortcuts preserve their individual verified ranges when inserted, so editing ordinary template prose does not remove unrelated skill references.
Project skills use project-relative paths; global/system skills use absolute paths, with project → global → system precedence for duplicate tokens.
Runtime index revisions and directory recovery refresh an open menu; body-read updates do not cancel its selection.

Rendered coverage lives in [composer journeys](../../../../tests/e2e/features/composer-mentions.feature), including category navigation, touch, atomic editing, two narrow viewport sizes, axe, live Desktop index changes, caret insertion, IME/Escape, draft reload and one-turn expansion.
The upstream navigation case uses real key presses, touch scrolling and pointer clicks; assigning a textarea selection and dispatching a synthetic `select` event does not exercise React’s selection event path.
Keyboard-selection assertions check rendered background colors in both themes, including movement from the old row to the new row. `aria-selected` alone does not prove visible highlighting; applying mention classes to Button lets its separate variant/reset classes override them.
