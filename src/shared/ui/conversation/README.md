# Conversation rendering

This boundary ports Lody's conversation rendering from revision `5febbcee694df25a3c5514631c3367d413b30f39`.
The extension supplies ordered history items, turn status and its own permission actions; desktop session stores, file access and navigation remain outside this module.

| Responsibility                      | Source and adaptation                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content ordering                    | [`assistant-message-render-items.ts`](./assistant-message-render-items.ts), copied from [upstream](../../../../vendor/lody/packages/components/src/components/ai-gui/assistant-message-render-items.ts). Plans precede their approval and attachments follow the answer.                                                                                              |
| Activity groups and plan boundaries | [`assistant-turn-render-blocks.ts`](./assistant-turn-render-blocks.ts), copied from [upstream](../../../../vendor/lody/packages/components/src/components/ai-gui/assistant-turn-render-blocks.ts). Local validated types replace the desktop shared package.                                                                                                          |
| Final answer visibility             | [`message-copy.ts`](./message-copy.ts) preserves upstream's final contiguous text run within each plan/implementation segment.                                                                                                                                                                                                                                        |
| Rendered controls                   | [`AssistantTurn.tsx`](./AssistantTurn.tsx) adapts `ProcessDisclosureButton`, `ActivityGroupHeader`, `WorkedGroupHeader` and tool detail sheets from [view.tsx](../../../../vendor/lody/packages/components/src/components/ai-gui/view.tsx). It imports official `conversationSurface` StyleX directly and uses Lody buttons, the global icon mood and Motion springs. |
| Rich content                        | [`SpecializedContent.tsx`](./SpecializedContent.tsx) adapts upstream file cards, plans, goals and task summaries to Lody UI controls; [`specialized-content.ts`](./specialized-content.ts) validates the official payload fields and defines feature-owned attachment/command/navigation callbacks.                                                                   |
| Protocol boundary                   | [`content.ts`](./content.ts) validates known presentation fields while retaining unknown or malformed items as inspectable records. Original SDK turns remain untouched.                                                                                                                                                                                              |

Continuous tools and thoughts form collapsed activity summaries in their original position among commentary.
Thought prose is available inside the group, never rendered as a raw `thought` type label.
Only completed turns with visible result content fold into a finished-work disclosure.
Stopped, failed and tool-only turns retain their partial work; a plan approval divides work into independently foldable segments.
Long tool titles ellipsize within the reading rail, while their expanded command/output sheets wrap the complete text.
Only the live trailing activity group shows activity; prior groups do not acquire a spinner when later work starts.

The extension keeps thought-only groups collapsed.
Subagent cards show status, summaries, failures and expandable work records from the synchronized `run.items` snapshot.
Opening a separate child session requires a feature callback; the shared UI does not invent a desktop transport.

Attachment cards use the official file/image identity, including `storageSessionId` for forked references.
Feature callbacks load bytes through the SDK; this module never fetches a URL or a desktop path.
Local-only and expired files remain visible with their actual availability.
Downloads use object URLs revoked on unmount.
Raster images open in a preview dialog; text previews show an inert prefix of at most 1 MiB and name truncation.
Other documents download for viewing.
PDF rendering, public sharing and remote desktop file access are not supplied by this boundary.

Plans, goal status, recognized system notices and command callbacks use validated fields.
Unrecognized or malformed records retain their original inspectable data, and system notices retain technical details alongside readable diagnostics.
Permissions stay with the feature adapter so folding history cannot hide an unanswered request.
The raw tool projection lives here and is also used by the feature adapter for activity metadata.

When refreshing Lody, compare the three copied grouping modules against upstream and retain the boundary adaptations above.
The [cloud-history journeys](../../../../tests/e2e/features/assurance.feature) exercise narrow rendering, expanded commands/thoughts, streaming completion and cancellation through real Loro snapshots; Storybook covers the same long transcript.
