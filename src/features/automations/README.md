# Automations

This feature connects Lody's synchronized Prompt Shortcuts and machine-owned schedules to the browser composer.
The SDK owns the upstream schemas, resource authorization, CRDT synchronization and publication protocol; feature adapters own credentials, scoped storage and UI lifetimes.

| Owner                                                                                                               | Responsibility                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [AutomationsPanel](./AutomationsPanel.tsx)                                                                          | Pushed list/detail surface, shortcut management and authoritative schedule runtime presentation.                            |
| [Shortcut adapter](./shortcut-client.ts) and [composer source](./prompt-shortcut-source.ts)                         | Account-scoped storage and sync lifecycle; validate authorized revisions and dependencies before inserting a prompt.        |
| [Legacy migration](./shortcut-migration.ts) and [storage](./storage.ts)                                             | Preview and explicitly migrate browser-local templates while retaining original records and immutable migration identities. |
| [Schedule editor](./ScheduleEditor.tsx) and [recurrence](./recurrence.ts)                                           | Calendar choices, target/destination validation and unchanged-trigger preservation.                                         |
| [Schedule journal](./journal.ts)                                                                                    | Persist immutable mutation payloads before publication and replay the same identity after uncertainty.                      |
| [SDK shortcuts](../../../packages/lody-sdk/src/shortcuts) and [schedules](../../../packages/lody-sdk/src/schedules) | Protocol validation, resource-scoped grants, publication recovery and machine-owned execution records.                      |

## Prompt Shortcuts

The shortcut model, catalog, document and publication lifecycle follow [Lody's shared implementation](../../../vendor/lody/packages/shared/src/prompt-shortcuts).
Desktop and extension use the same account/workspace directory and shortcut identity.
The cloud directory establishes access; Flock indexes supply search labels; immutable Loro bodies supply coherent prompt text and mention ranges.
The feature refreshes the authoritative HTTP directory every 15 seconds, on reconnect and before a body read; index rooms stream updates continuously.
A cross-device revision becomes selectable only after its body and revision match the refreshed directory, so an open menu can take one directory interval to update.
Each index or body requires its own exact-resource grant, outside the ordinary workspace stream prefix.
A workspace token cannot authorize private shortcuts.
Shared shortcuts from another member are readable and copyable; only the owner can edit or revoke them.

Opening either shortcut surface exchanges the session bearer for a Convex JWT, queries the directory through `/api/query`, then requests index grants through `/api/action` before any shortcut is selected.
The extension's [worker network policy](../network/protocol.ts) must permit that entire chain; permitting only directory queries leaves a populated menu unable to load.
Publication also uses `/api/mutation`.
Web previews use native fetch, so they cannot verify these worker routes.

Saving retains a local outbox operation before staging and uploading a new body.
Activation checks the prior body and revision before publishing the matching index.
Visibility changes rotate the body; making a shortcut private cannot remove copies already received by another member.
Pending writes and protocol failures remain visible with a retry action.
The adapter closes old subscriptions, requests and storage ownership when account, workspace or deployment changes.

The composer merges synced shortcuts with Agent commands in its `/` menu.
Browsing reads the index and scope metadata without requesting every referenced skill from the machine.
An unrelated publication failure does not hide readable shortcuts; an empty failed directory remains an explicit error.
Selecting a shortcut checks the current authoritative entry, body revision, scope and dependencies before replacing the trigger at the caret.
Skill references retain their upstream target identities; missing or unsupported references block insertion with a reason.
The existing draft, surrounding text and mention ranges are preserved, and selection never submits a turn.
The chat feature owns `$` skill expansion into the single frozen submission prompt.

Legacy browser templates remain in `client.accountKey` and workspace-scoped storage.
Opening the manager does not upload them.
Migration shows a preview, defaults to private visibility and retains an immutable identity before any publication, so a retry cannot create another shortcut.
Original local records remain available after migration.
Legacy `{{parameters}}` remain literal text for the user to fill in the draft; `includeCurrentPage` remains a browser behavior and does not become a cloud field or an authorization grant.

## Schedules

The schedule surface follows upstream's narrow list/detail layout and imports its settings card material.
The recurrence adapter is ported from Lody `schedule-recurrence.ts`; validation and preview use the independent SDK.
Calendar forms use the selected machine's timezone, with the browser timezone only for older machine metadata.
Opening an existing rule and saving without changing its recurrence preserves the original trigger, including unsupported calendar expressions.
The editor keeps the original target until the user explicitly chooses the current conversation assistant.

Each save, enable/disable, manual run or delete is journaled before cloud publication.
An uncertain mutation blocks a second mutation in that scope until recovery replays the retained payload.
A synchronized definition is not a successful execution: the list accepts runtime rows only when machine, activation and definition fingerprint match the current registry row.
The latest dispatch links to its result conversation and is labelled as dispatched, not completed.
Execution belongs to the runtime machine and does not depend on the browser staying open.
Recording browser actions and browser-only scheduling require separate execution protocols.

## Verification

The [automation journeys](../../../tests/e2e/features/automations.feature) declare synced shortcut and explicit legacy migration obligations separately from schedule recovery.
Their [shortcut boundary](../../../tests/e2e/support/shortcut-boundary.ts) supplies actual Flock/Loro bytes and Convex/Streams HTTP responses, including preexisting Desktop-format private/shared records, exact-resource grant rejection and revision checks.
It does not mock the SDK or its runtime.
The [packaged shortcut test](../../../tests/extension/shortcuts.spec.ts) opens the actual extension surfaces and checks that initial directory and index authorization requests pass through the worker, including after a reload.
[Browser infrastructure tests](../../../tests/browser/automations.browser.test.ts) cover legacy storage, retained schedule mutation identity and daylight-saving conversion.
[Storybook](./AutomationsPanel.stories.tsx) uses labelled in-memory preview data; its visual states are not cloud synchronization evidence.
Actual pass/fail evidence comes from the generated [coverage report](../../../COVERAGE.md).
