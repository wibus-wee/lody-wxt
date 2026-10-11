# Release and post-release continuity

Release please batches conventional commits into one root Node release PR.
The initial manifest records the current package version, `0.1.0`; adding configuration does not publish it.
Release PRs update `package.json`, the manifest and changelog together.
A merged, externally approved version increase triggers tag promotion.
Conventional `fix` and `perf` changes produce patches; `feat` produces a minor release, and breaking changes before 1.0 produce a minor release per the orchestration policy.
SDK publishing is outside this pipeline.

`release-please.yml` deliberately skips release-please's GitHub-release creation.
A read-only planning job detects a manifest change against the preceding commit.
Its separate promotion job waits on the `release-promotion` environment, verifies that independent required-reviewer protection is actually configured, then validates the package version and increasing stable Chrome-compatible version and creates a lightweight tag at that exact commit.
An existing tag must point to that same commit.
It explicitly dispatches `release.yml`, because tag pushes authenticated with `GITHUB_TOKEN` do not trigger other workflows.
The tag job has `actions: write` solely for dispatch; the proposal job has contents and pull-request write permissions.
A tag created with another token can also trigger the push entry point; release concurrency serializes duplicate dispatches.
Retrying promotion on the same commit resumes after a tag-create/dispatch interruption.
Manual packaging accepts an existing stable tag.
Do not move tags to retry releases.

## Tagged source and packaged verification

The package job checks out the tag and recursively initializes its recorded submodules.
It validates the root package version, HEAD, tag membership in protected main history, clean tracked source, and both submodule revisions and worktrees.
Installation uses the frozen lockfile with scripts disabled.
Checks include `pnpm check`, SDK and SDK-consumer tests, browser infrastructure tests and the Playwright extension suite against the tagged WXT build.
The workflow sets `LODY_UI_PINNED=1` and uses the coordinated pinned build interface in `scripts/sync-ui.mjs`, which requires the initialized exact recorded gitlink and avoids remote synchronization.
It runs SDK/UI preparation, the standard `pnpm test:extension` and `pnpm release:package` scripts while that flag is set.
Packaging uses the existing release tooling.
Source and submodule checks run again after building; any movement from the tag fails publication.

The existing `tools/release/check-install.mjs` extracts the actual downloadable archive and installs its `lody` directory into Chromium.
It exercises settings, sidepanel and onboarding, checks preferences survive a same-directory browser restart and requires zero axe violations.
Reports, screenshots and traces are retained by Actions.
This is an unpacked Chrome installation test, not a Chrome Web Store update test or a live authenticated backend availability probe.

Before any extraction, before upload and again after downloading remote assets, `release-plan.mjs` verifies an exact four-entry SHA-256 inventory, archive length and digest, appcast download URL and version, clean build provenance, tagged source commit, tagged Lody and Runeicons gitlinks, and the exact tagged lockfile digest.
It inspects the ZIP using isolated Python stdlib code before extraction: unsafe or duplicate paths, symlinks and other special entries, encrypted entries, invalid CRCs, over 10,000 entries and over 512 MiB expanded size fail closed.
The Manifest V3 version and required runtime entrypoints must match; development files are rejected.
Embedded provenance and installation instructions must exactly match their public companion files.
Assets must be nonempty regular files: the archive is capped at 256 MiB, JSON/guide companions at 2 MiB and the checksum inventory at 4 KiB.
Embedded metadata is bounded to 2 MiB each and ZIP inspection to 60 seconds.
The five public assets are `lody-chrome.zip`, `INSTALL.md`, `SHA256SUMS`, `build-info.json` and `appcast.json`.
Release notes remain the release body.
SHA-256 and build-info provide integrity and source/dependency traceability; the protected publisher additionally creates and verifies signed GitHub provenance attestations for all five public assets.

## Publication, retries and recovery

Publication waits on `release-publication`, checks actual environment reviewer protection, and uses the controller from trusted `main`, never code from the product tag.
It resolves the tag again and requires both the packaged commit and the workflow-definition SHA to remain ancestors of `origin/main`.
Only main-branch or exact release-tag workflow refs are accepted by the trusted binding step.
Publication has contents write, Actions read (to inspect environment protection), OIDC `id-token: write` and `attestations: write` permissions in its own job.
The tagged build job has only contents read; it never receives signing or publication permissions.
Checkout credentials are not persisted.
Before signing, the publisher reruns all checksum, ZIP safety, embedded metadata and tagged provenance checks using trusted-main tools.
It then runs `actions/attest-build-provenance@v3` over exactly the five public assets and verifies every subject with `gh attestation verify` against the returned bundle, repository, exact signer workflow/digest, source SHA/ref, SLSA v1 predicate and GitHub-hosted runner requirement.
No artifact is published if attestation creation or verification fails; there is no unsigned fallback.
The bundle and verification JSON are retained in a separate attempt-specific Actions evidence artifact, keeping the public release inventory unchanged.
A retry can create another valid attestation for the same immutable subject bytes without replacing release assets.
The publisher first successfully lists releases, so API authentication or transport failure cannot be mistaken for absence.
It creates a draft, compares every existing remote asset byte-for-byte with the verified local assets, uploads only missing names, downloads the complete inventory again and verifies it before publishing.
It never uses overwrite/clobber or deletes remote assets.
A published release must already have the entire identical inventory.
An interrupted upload can be accepted remotely even when the client reports failure; rerunning the failed publish job re-inspects the remote state before doing anything.

Rerun the failed publish job using its original uploaded Actions artifact.
Artifact names include run ID and attempt; the saved package-job output selects the original artifact when only publication is retried.
A full rebuild can produce different ZIP bytes; it must fail against existing assets instead of replacing them.
If any published asset differs, investigate and publish a new version.
Do not repair published downloads in place.
The workflow enforces immutability for its own operations; repository-wide GitHub immutable-release settings and permissions of other actors are external controls and have not been verified here.

## Installed release monitor

`release-monitor.yml` runs every six hours, after Release completes, and on manual dispatch.
It resolves the real latest stable published release through the API; it does not infer success from a source build or a workflow conclusion.
It downloads published assets with the policy retry limit plus one transport attempt (currently three attempts, with 5 and 10 second backoffs, clearing partial downloads between attempts), checks checksums and provenance against the tagged Git objects, installs trusted-main controller dependencies with scripts disabled, and runs the trusted controller installed-archive verifier with `product` as its working directory.
The product tag supplies Git objects and release identity, never executable verifier code or dependency versions.
Before installation, the monitor additionally retrieves and verifies attestations for every public asset, restricting the certificate identity to the release workflow on main or the exact release tag, requiring the repository and SLSA v1 predicate, and rejecting self-hosted signers.
Only its read-only installed-artifact job receives `attestations: read`; the monitor has no OIDC/signing permissions.
An older release without valid attestations fails monitoring rather than silently bypassing the signature requirement.
Token-bearing GitHub reads finish before dependency/browser execution, which explicitly clears `GH_TOKEN`.
Product build commands are never run in the monitor.
The reported browser version, tested release version, exact archive digest, retained preferences, restart, surface navigation and axe result must all pass before recovery is reported.
Product/test failures are not retried into a pass.

The monitor serializes all runs.
A separate job with issues write permission lists all issues with pagination and accepts an exact leading per-tag marker only on issues authored by `github-actions[bot]`, preventing copied markers in user issues from authorizing edits.
It creates at most one open incident per release.
A recurrence inside the policy cooldown (currently 24 hours) reopens the existing incident rather than creating a duplicate, retaining any known immutable archive identity.
Download failures retain the same incident identity even when no archive digest is available.
Repeated failures leave the open incident in place.
Successful checks close only incidents for the tested release, with a recovery comment linking the run and identifying the verified archive digest.
Unavailable, stale or incomplete browser evidence cannot close an incident.
If an incident recorded a known archive digest, recovery must match it; changed published bytes leave the incident open and fail reporting.
An incident caused by an unavailable download can close after a complete verified download; if a later failed browser run obtains a verified archive identity, that identity is recorded before any future closure.
A new release passing does not prove recovery of an older version; older incidents require explicit investigation.
A failure resolving the latest release before a tag is known remains a failed workflow rather than fabricating an affected release incident.
Actions run notifications are needed for this bootstrap/API failure path.

## External prerequisites and interface report

These files do not establish that any external configuration exists.
Before enabling publication, configure and verify the `release-promotion` and `release-publication` environments.
Each must have at least one required reviewer, prevent self-review, disallow administrator bypass and restrict deployment refs.
The runtime guard refuses missing or unprotected environments; merely naming an environment in YAML does not prove it is protected.
Configure branch/tag selectors to permit only the intended protected main branch and approved stable tags.
Protect stable tags against creation outside the approved release path, movement and deletion.
Verify Actions can create pull requests, required branch checks and rules, release permissions, issue availability, Actions artifact retention and workflow-failure notifications.
GitHub artifact-attestation availability for this repository, OIDC issuance, attestation API permissions and access to the Sigstore trust services are external prerequisites and have not been verified by local tests.
In particular, private/internal repository availability can depend on GitHub plan and configuration; this code does not establish support.
An optional `RELEASE_PLEASE_TOKEN` (fine-grained token or appropriately scoped App token) allows release-please PR events to trigger normal checks; the fallback repository token cannot trigger those checks.
Configure token scope and renewal outside this repository.
PR approval/merge policy is also external; this pipeline does not bypass it or claim unattended merges are enabled.
An environment reviewer approves the exact promotion commit or the publication run after reviewing its source and packaged-install evidence; a release-please PR, conventional commit or green unit test is not itself that approval.
The promotion job's explicit dispatch does not require a separate release token.

The pinned build interface is `LODY_UI_PINNED=1` in `scripts/sync-ui.mjs`; normal development still tracks Lody main.
Older tags without this interface cannot be assumed to package successfully.
See [RUNBOOK](./RUNBOOK.md) for current environment state and [VALIDATION](./VALIDATION.md) for build blockers.

Standalone tooling tests: `node --test tools/autonomy/release-plan.test.mjs tools/autonomy/monitor.test.mjs`.
They cover malformed tags, checksum/provenance corruption, asset inventory mismatch, an upload accepted before its response is lost, safe rerun completion and immutable reruns, incident deduplication and rejected stale browser evidence.
Run the project checks and extension suite as required by AGENTS.md; a missing submodule or credential failure is a verification blocker, not a passing check.

## Protected release intent and orchestration boundary

The current policy marks `package.json`, lockfiles, release manifests/configuration, `.github/`, `tools/autonomy/` and the other build/governance files as protected. `validateDecision` refuses normal autonomous ACCEPT for elevated or protected changes, and `mergeGate` refuses protected merges.
Release-please batches a proposal; it does not authorize a version bump, merge, tag or publication.
The initial manifest is bookkeeping, not approval to publish the existing version.

A release proposal needs explicit version intention: previous and next version, the included conventional changes, breaking/API impact, release notes, source commit, dependency/lockfile changes, and links to tagged-source, package, extension and installed-archive evidence.
Independent protected approval must bind that intention and evidence to the exact PR SHA.
After merge, promotion and publication have their separate configured required-reviewer gates.
Review the immutable asset inventory and checksum/provenance results before approving publication.
Never classify a version or build-policy change as a normal fix to bypass protection.

Interface blocker reported to the main orchestration owner: `contract.mjs` currently accepts only feat/fix/perf/refactor/docs/chore and has no protected release/version-intent schema.
Package changes count as runtime changes, so a generated release-please PR cannot satisfy the normal chore/docs contract, while using feat/fix would require invented product journeys.
This release implementation does not fabricate that evidence, override the contract, or claim such PRs can auto-merge.
Keep release PRs on the independent protected review path until the main owner provides an explicit trusted release-intent/approval interface.

Dependency/runtime prerequisites include Node 26, pnpm from the trusted package manifest, Python 3 for bounded ZIP inspection, zip/unzip for existing packaging, recorded submodule access and Playwright Chromium.
Environment creation is recorded in [VALIDATION](./VALIDATION.md); main/tag protection, signing and publication readiness remain unverified.
SHA-256/provenance checks validate the approved package inventory.
The attestation authenticates the protected publisher workflow and the verified subject bytes; it does not independently prove that tagged candidate code was harmless, that the build was hermetic/reproducible, or that dependency/test reports cannot lie.
The tagged source executes in the separate read-only hosted build job before any privileged publication; the protected source review, immutable tag controls and required publication approval remain part of the trust boundary.
Trusted-main controller checkout is distinct from the workflow-definition identity recorded by OIDC, so the binding step also checks that workflow SHA and allowed ref before signing.
GitHub signing and verification occur only in actual workflow runs; local command-construction tests do not claim live signature verification or installed external configuration.
Platform-level release immutability, signed-workflow availability and protection of main/tags remain separately configured controls.
