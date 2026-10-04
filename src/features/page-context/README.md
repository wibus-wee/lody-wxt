# Browser sources

This feature owns explicit browser capture and local source previews.
It passes immutable, untrusted page snapshots or real `File` objects to the quick draft; the connection adapter owns SDK submission.
The [browser assistant specification](../../../docs/content/browser-assistant-spec.mdx) defines the broader capability target.

| Area             | Entry point                                                                  | Contract                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser entry    | [lifecycle](./lifecycle.ts), [intents](./intents.ts)                         | Toolbar/shortcut opens the surface. Context-menu capture uses the event tab/frame, requires confirmation and never sends.                         |
| Page snapshots   | [capture](./capture.ts), [model](./model.ts)                                 | Fixed source identity, sanitized locator, capture time, length, truncation and revision. Closed or navigated tabs are failures, not replacements. |
| Source selection | [PageContextMenu](./PageContextMenu.tsx), [ContextStrip](./ContextStrip.tsx) | Lody controls, previews, explicit refresh/removal and scope lifetime fences.                                                                      |
| Visual input     | [screenshot](./screenshot.ts), [image](./image.ts)                           | Actual image bytes; capture validates tab/document/viewport/scroll before and after. Pointer and numeric crop share pixel coordinates.            |
| Documents        | [pdf](./pdf.ts), [video](./video.ts)                                         | Local PDF text layer with page numbers; exposed browser text-track cues with timestamps. Missing text is reported.                                |
| Local library    | [library](./library.ts), [LibraryPicker](./LibraryPicker.tsx)                | Optional history/bookmark grants, explicit bounded search, selected links, confirmed bookmark mutations and permission revocation.                |

## Composer entry points

The composer separates source selection, execution tools and dictation.
Its controls use Lody UI; the compact attachment menu follows the original [attachment menu](../../../vendor/lody/packages/components/src/components/chat/attachment-add-menu.tsx).

| Intent                                                                                            | Entry point                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Include the current page at send time                                                             | [ComposerContextBar](../chat/ComposerContextBar.tsx), off until explicitly enabled |
| Select one or several tabs                                                                        | The same context bar opens one [TabContextPicker](./TabContextPicker.tsx)          |
| Add files or a screenshot                                                                         | The `+` menu; files also support paste and drop                                    |
| Capture a fixed page snapshot, selected text or subtitles; add links, library records or PDF text | `+` → [SourcePickerDialog](./SourcePickerDialog.tsx), grouped by source            |
| Select skills or workspace connectors                                                             | The separate tools menu; `$` still opens inline skill suggestions                  |
| Dictate a draft                                                                                   | The microphone beside Send, when browser speech recognition is available           |

The `+` menu has exactly three actions: files, screenshot and other sources.
Opening a picker or toggling current-page inclusion does not capture content or submit a message.
Current-page inclusion retains its draft-scoped, explicit opt-in behavior; source selection never enables it implicitly.
Browser context-menu actions still capture the selected source for confirmation in the side panel.

## Source and draft lifetime

`PageContextMenu` is keyed by the owning draft and receives its account scope.
Its lifetime controller prevents delayed capture or import from calling an old draft callback after unmount.
The parent also fences draft updates.
Right-click intents live in trusted extension `storage.session`, expire after ten minutes, and are filtered by a digest of the account session/workspace and browser window.
Browser restart discards them.
Neither opening the panel nor accepting an intent creates a remote session.

Page capture retains up to 12,000 text characters and reports the full extracted character count.
Visible main/article content, open shadow roots and accessible same-origin frames are read.
Inaccessible frames are named as excluded coverage; closed shadow roots, hidden content, form fields and editable regions are excluded.
A snapshot revision detects changed extracted text; a document ID detects navigation.
Refresh creates a new ID and changes only the explicitly selected draft attachment.

Public URLs retain only a small locator allowlist: YouTube video/time parameters, GitHub line anchors, Google Docs heading anchors and PDF page fragments.
Other query parameters and fragments are discarded.
Raw browser URLs remain transient browser API inputs.
A link attachment means an address was selected, not that its contents were read.

## Toolbar permission contract

Chrome's `openPanelOnActionClick: true` path returns from [`ExtensionActionRunner::RunAction`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/extension_action_runner.cc) before granting `activeTab`.
Consequently the native side-panel toggle can open successfully while `captureVisibleTab` still fails.
A host grant for one website does not replace the screenshot API's `activeTab` requirement.

The lifecycle therefore sets `openPanelOnActionClick: false` and opens the panel synchronously from `action.onClicked`.
Chrome grants that user-invoked action temporary access to the current tab before dispatching the event.
This preserves the toolbar experience without requesting default access to every site.
Keep the action listener in the feature; the background entrypoint only registers it.
Revisit this decision if Chrome changes the documented source behavior, and retain the real toolbar-to-screenshot regression.

When `sidePanel` is unavailable, the shared opening action opens the existing options page and reports the missing capability.
This is a diagnostic fallback, not a claim of Firefox sidebar parity.

## Files, permissions and failure

PDF.js and its worker are bundled locally; there is no CDN worker or new CSP allowance.
Extraction is explicit, limited to 25 MB, 100 pages and 120,000 characters.
The preview distinguishes truncated output and pages without a text layer.
Import adds a page-numbered text file only after confirmation.
Password-protected files require local unlocking; OCR is not configured.
Browser-exposed subtitles can seek the captured document by timestamp.
Private video transcript endpoints and automatic transcription are not used.

Screenshots are visible-viewport images.
They do not claim full-page capture.
A navigation, tab switch, viewport or scroll mismatch cancels capture.
Visible password/OTP/sensitive fields block it.
Image-link reads request the exact origin, omit credentials, reject redirects and cap bytes; authenticated images may need to be saved and uploaded manually.

History search requires a user query, 1–30-day range and optionally an exact domain, returning at most 50 records.
Bookmarks are searched only after a query.
Search results remain local until a selected address is added to a draft.
Mutations re-read the selected bookmark before moving or deleting it; confirmation names the affected record.
Revoking access clears displayed results and the next query must obtain permission again.

## Verification

[Extended packaged journeys](../../../tests/extension/extended-context.spec.ts) cover exact multi-tab capture, closed-source failure, shadow/frame content, immutable refresh, safe locators, truncation, the local PDF worker under extension CSP, real image previews, toolbar-granted screenshots and pixel-accurate crop, navigation refusal, bounded history and bookmark create/move/delete/revoke.

The source-picker case checks the three-action menu, separate context/tools/dictation controls, current-page opt-in, keyboard entry, restored focus and axe at 360px.
It also uses native `chrome.tabs.setZoom(2)` at a 640 × 960 browser viewport, checks the resulting 320px layout for reachable composer controls and horizontal overflow, and attaches a screenshot.
The screenshot case invokes Chrome's actual toolbar action through CDP `Extensions.triggerAction`.
The library case installs an isolated extension copy with initial grants, restores its manifest byte-for-byte to production, and then runs with real revocable optional permissions.
That controlled permission baseline is attached to the trace; acceptance of Chrome's native permission dialog is not automated.
JavaScript modules and CSP are unchanged.

Non-component browser tests exercise PDF bytes/worker and capture contracts.
Storybook `Chat/Page context` covers the compact attachment menu, grouped source picker, full source limit, snapshot, mixed tab results and the PDF importer.
Model cases and all checkpoints are owned by [assurance model](../../../tools/assurance/model.mjs), not inferred from test discovery.
Run `pnpm check`, affected browser tests and `pnpm test:extension`; generate coverage only from their real reports.
