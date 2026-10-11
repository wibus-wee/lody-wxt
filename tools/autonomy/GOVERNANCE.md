# Trusted acceptance deployment requirements

The `autonomy` environment MUST store the App private key and Dots/image secrets as environment secrets, with custom deployment branch rules permitting only the branch `main` (no tags or other branches).
Do not also install these credentials as repository or organization secrets available to candidate workflows.
The App installation must be limited to this repository and necessary permissions.
YAML ref guards alone cannot secure a branch that can modify its own workflow.

Acceptance and revocation check out protected main and require its commit to equal the workflow source SHA before provisioning the App token.
Main advancing before checkout fails closed; rerun from the current snapshot.

The current policy uses `mergeStrategy: protected-auto-merge`, supported on personal repositories.
It requires strict source-head checks, an up-to-date base, exact PR/source candidate identity and no active queue.
If policy explicitly selects `merge-queue`, the active main queue rule MUST set both `max_entries_to_build` and `max_entries_to_merge` to 1 and revalidate the integration SHA.
Unknown or missing strategies fail closed.
Acceptance rejects ambiguous/multiple PR associations and publishes success only after all deterministic checks pass.

App-owned acceptance check output records expiry, PR/body/base/head/policy identity and the verified signed decision context hash.
The revoker accepts metadata only from checks owned by the pinned App; it never consumes author-provided metadata or writes success.
It revokes on PR edits/synchronization/closure/draft changes, main pushes, and scheduled expiry sweeps.
Existing green checks without metadata are revoked.

GitHub checks have no native expiry and Actions event/schedule delivery is asynchronous.
Five-minute cron is not a maximum delay: scheduler delays, outages, missing credentials or API errors can leave an expired green check visible until a successful sweep.
PR edits and publication are not atomic with GitHub queue merging.
Strict zero-window freshness requires a platform merge-time enforcement mechanism; this implementation cannot guarantee it.
A successful queue check may merge before revocation executes.
Keep unattended merges disabled where that guarantee is required.
