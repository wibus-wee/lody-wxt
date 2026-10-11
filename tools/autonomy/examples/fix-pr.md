## What changed?

Preserve the reader's scroll position while a response continues streaming.

## Who does this help?

People reading earlier messages can keep their place as new response chunks arrive.

## Expected behavior

Send a message, scroll up during streaming, and keep the chosen position.
Choosing return-to-latest resumes automatic following.

## Failure and recovery

Incoming chunks must not pull the reader to the bottom while following is paused.
History and the unsent draft remain available after reload.

## Scope

**Type:** Bug fix
**Areas:** Web app, Browser extension

- [ ] Breaking change

## Verification

- [ ] Browser journeys passed
- [ ] Packaged extension journeys passed

### Test links

- tests/e2e/features/scroll-follow.feature
- tests/e2e/journey-steps/scroll-follow.ts

## UI evidence

Show the reader paused above the latest response and the return-to-latest action on each affected surface.

<!-- autonomous-ui-evidence:start -->

Awaiting actual before/candidate captures and their test run.

<!-- autonomous-ui-evidence:end -->

## Release note

Preserve reader position during streamed responses.

<details>
<summary>Journey references and special cases</summary>

### Affected journeys

- send-and-continue/reader-scroll

### Added or updated journeys

- send-and-continue/reader-scroll

### Capture plan

- [Capture plan](tests/e2e/captures/reader-scroll.json)

</details>

This is an example, not a real fix or passing evidence.
Create the referenced capture plan for the actual changed files; it is not supplied by this example.
Check the verification boxes only after the real journeys pass.
The independent probe must restore the broken follow behavior, detect the intended failure, and pass after restoring the candidate.
