# Assistant-maintained pull requests

Dots means the connected personal assistant, not a separately hosted reviewer API.
The assistant watches PR changes, inspects code, real test results and screenshots, and merges only the exact reviewed revision after all requirements pass.
No additional signing service or acceptance GitHub App is needed.

1. Describe the user-visible outcome and failure/recovery behavior in the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md).
2. PR Quality runs real browser and packaged-extension journeys and publishes immutable evidence for its exact head and attempt.
   Failures and skipped coverage remain visible.
3. PR UI Evidence captures applicable before/candidate screens.
   The assistant must view the actual images and verify the source commit, plans, raw bytes and affected states; an artifact link alone is not acceptance.
4. PR Review Context authenticates evidence using read-only GitHub access and produces a PENDING packet.
   It does not call a model service, post acceptance, approve a PR or merge.
5. The assistant independently reviews the packet and raw evidence, publishes verified screenshots through its existing authorized GitHub connection when needed, and rechecks the latest head, base, description, policy and required checks immediately before requesting a protected merge.

A green context-preparation job proves only that evidence was assembled.
It is not an acceptance check.
The event subscription belongs to the assistant and must be configured separately; deploying these files does not install it.
New commits invalidate old reviews.
Missing evidence, unknown protection, failed checks and unresolved findings block merging.
Protected workflow/policy changes require approval outside the change.
Release publication remains a separate transaction.

- [Operations and migration](./RUNBOOK.md)
- [Review authority and freshness](./GOVERNANCE.md)
- [UI evidence](./UI.md)
- [Regression probes](./PROBES.md)
- [Release controls](./RELEASE.md)
- [Verification design](./VERIFICATION-DESIGN.md)
- [Historical validation and current limits](./VALIDATION.md)

Use `pnpm autonomy:preflight` for read-only repository configuration inspection.
Do not infer full unattended operation from passing tooling fixtures or repository auto-merge being enabled.
