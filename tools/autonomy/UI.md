# Trusted built UI evidence

Screenshot images must never be committed to Git.
Capture plans are instructions, not images; only these instructions belong in source control.
The browser writes PNGs to ignored temporary reports, CI retains them as run artifacts, and the trusted publisher uploads the images as GitHub attachments and embeds their URLs in the PR body.
The trusted diff classifier rejects committed screenshot/report directories and binary capture-plan files, even if force-added past `.gitignore`.
Product image assets such as logos are not screenshot evidence.

`PR Quality` runs on `pull_request` and `merge_group` with `contents: read`, a detached exact candidate SHA and no persisted checkout credentials.
Its required checks cover `pnpm check`, SDK and package smoke tests, browser tests, real Cucumber/extension assurance, strict assurance audit, and Firefox, web, docs and Storybook builds.
Its job ID is `verify` and check name is `PR Quality / verify`.
`LODY_UI_PINNED=1` prevents remote UI updates.
The artifact `autonomy-evidence-${CANDIDATE_SHA}-${runAttempt}` includes original reports, compiled `dist/web` with `.autonomy-build.json`, and the actual `.output/chrome-mv3` package.
Multiple upload roots preserve `reports/`, `dist/web/` and `.output/chrome-mv3/` prefixes.
Candidate code and artifact metadata remain untrusted.

## Capture boundary

The separate `PR UI Evidence` workflow runs after a successful `PR Quality` run with read-only contents, Actions and pull-request permissions.
It has no publisher credentials or PR write permission.
It authenticates the source run, current PR or merge-queue head, source artifact and source commit tree through GitHub, then checks out the exact protected base SHA.
It installs protected dependencies, builds the before version and executes only the protected base capture controller and fixtures.
The candidate artifact is downloaded outside the checkout; web assets are served as static bytes and extension assets are loaded by Chromium as an installed unpacked extension.
Candidate Node modules, scripts and fixtures are never imported or installed in this workflow.
The capture command rejects execution unless its controller lives in the protected before checkout.
Protected base versions missing the capture implementation fail closed until the implementation lands on that base.

The PR body describes the change in ordinary Markdown.
Its `Capture plan` subsection links one JSON data file under `tests/e2e/captures/`; a coding agent can prepare that file.
The author does not paste JSON into the PR body.
Trusted orchestration reads the linked file from the exact candidate commit and checks its plan hash against the separate capture run.
The workflow reads the current PR body, changed files and linked plan through GitHub and passes them as data to the protected controller.
No plan is evaluated as JavaScript or imported as a Node module.
Ordinary UI changes can declare new routes, controls and states without changing the protected controller.
Missing or empty UI plans fail closed; there is no generic account fallback for unrelated UI changes.
Protected impact classification skips browser builds/capture for nonvisual changes and records `not-applicable.json` without inventing screenshots.
Executable documentation sources and build hooks do not qualify for the plain-Markdown exemption.

## Data-only plans and supported surfaces

Each plan declares `surface`, internal hash `route`, unique `scenario`, descriptive `state`, initial `account` state, `covers` paths and `actions`.
Extension plans also declare `entry: "options"`, `"sidepanel"` or `"popup"`.
`covers` must refer to the actual changed paths, and trusted orchestration verifies that the reviewed affected paths and required surfaces are represented.
Required web/extension surfaces and popup/sidepanel/options entries come from the protected dependency graph, not solely the author declaration.
Missing reachable surfaces or entries block capture acceptance; unresolved runtime UI reachability escalates for independent review.
Non-UI metadata labels such as `docs` and `sdk` do not become capture targets.
Every scenario must finish with a real visible-state assertion.
For an added control or route, an optional `before` object declares the actual old `route`, `state`, initial `account` and typed `actions`; it does not require the new control to exist in the old build.
Without `before`, both revisions execute the same plan.
Each manifest image records its actual role-specific route and state, while the shared scenario identifies the comparison.
For example, the linked data file contains an array of plans like the following; add corresponding entries for each affected surface.
This is file configuration, not PR-body authoring:

```json
{
  "surface": "extension",
  "entry": "options",
  "route": "/#/settings",
  "scenario": "appearance-controls",
  "state": "Appearance controls remain available after real account authorization",
  "account": "signed-in",
  "covers": ["src/features/preferences/model.ts"],
  "actions": [{ "action": "assertVisible", "role": "combobox", "name": "主题" }]
}
```

Paths and obligations must describe the actual PR; this example is not evidence for unrelated changes.
`validateCapturePlans(plans, { requiredSurfaces, changedPaths, requiredPaths })` validates the data contract.
`capturePlanHash` computes its canonical content hash.
`validateUiEvidence` requires the independently supplied `capturePlans`, matches the captured plan hash to current intent, and checks every planned route, state, surface, extension entry, theme, viewport and before/candidate role.
Extra generic images cannot satisfy a declared scenario.

Allowed control actions are `click`, `fill`, `press`, `check` and `uncheck`.
They target `role` and exact accessible `name` through real Playwright controls.
`fill` additionally accepts a bounded `value`; `press` accepts an allowlisted `key`.
`navigate` accepts only another validated internal hash `route` within the same surface and entrypoint.
Assertions are `assertVisible`, `assertText`, `assertValue`, `assertEnabled`, `assertChecked` and `assertAbsent`.
`assertAbsent` requires zero matching controls and cannot be the terminal assertion; a visible baseline must still be established.
Text/value assertions additionally accept `value`.
`fill` and `assertValue` allow an empty string so cleared-draft states can be declared; `assertText` requires nonempty text.
Positive assertions scroll their actual target into view before capture.
No selectors, scripts, evaluation hooks, arbitrary URLs, file operations, storage injection, unconditional-success actions or arbitrary sleeps are accepted.
Keys are Enter, Escape, Tab, arrow keys, Space, Backspace, Delete, Control+A, Meta+A and Shift+Enter.

Plans are bounded to 12 scenarios, 30 actions each, 32 KB total and 128 images after expanding the protected theme/viewport matrix and both revisions.
The matrix comes from protected policy; UTC, English locale, reduced motion, isolated contexts/profiles and a fixed browser clock reduce variability.
The initial account condition is `signed-in` or `signed-out`; visible actions may then exercise transitions such as sending, navigation, recovery or logout.
Known credential patterns in intent/plan data are rejected without printing their values.

Web plans use the protected Cucumber `AccountBoundary`, `RuntimeBoundary` and visible `signIn` helper.
Installed extension plans load the actual hashed Chrome package in a fresh Chromium profile and use a protected local HTTPS account server mapped to `backend.lody.ai`, following the existing persistence journey's transport boundary.
They authorize through the real device-login and workspace controls, not storage or login injection.
Signed-in extension capture requires observed device/session HTTP traffic owned by the real extension service worker.
The protected RuntimeBoundary supplies the same HTTP/Streams fixture for both source versions.
Theme setup uses real settings controls before opening the declared web route or installed options, sidepanel or popup entry.
A failed control, unsupported route, missing package, changed entrypoint or incomplete protocol assertion fails the run instead of substituting an image.

The real lifecycle entrypoint remains `cucumber.mjs`; screenshots do not replace assurance journeys.
Infrastructure tests validate plans, source identities and packaged-byte integrity without launching a browser.
Actual browser execution has not been verified in this session because the product build is blocked by the unavailable glyph source.
Native OS permission dialogs, unsupported/nonproduct surfaces and arbitrary custom fixtures remain outside this plan grammar and require separate independent evidence.

## Manifest and fixture binding

The screenshot manifest path is `reports/autonomy/screenshots/manifest.json`.
It contains `schemaVersion: 1`, `fixtureHash`, the canonical `plans` and `planHash`, per-image role, surface, extension entry, state, exact SHA, route, viewport, theme, scenario, relative PNG path and SHA-256 content hash, plus build receipts and capture provenance.
`captureContext` binds `controllerSha`, `sourceRunId`, `sourceRunAttempt`, `sourceArtifactId`, `captureRunId`, `captureRunAttempt`, `candidateTreeSha` and `baseTreeSha`.
Build-run and capture-run IDs must differ.
The artifact is named `autonomy-ui-${headSha}-${sourceRunId}-${sourceRunAttempt}-${captureRunAttempt}`.

Trusted orchestration must authenticate both successful workflows and download the screenshot artifact from the protected capture run, separately from the original build evidence.
It must independently compute the fixture hash from protected source, never trust the contributor's claimed hash.
`computeTrustedFixtureHash(baseTreeSha, readProtected)` computes it from the authenticated protected tree and the ordered `trustedFixtureInputs` list.
The reader must return protected base-ref bytes for each path.
Inputs include the capture controller, manifest validator, snapshot guard, protocol fixtures and lockfile; the authenticated Git tree binds their transitive source dependencies.

`verifyTrustedCapture(manifest, expected)` requires that independently computed hash and all authenticated capture-context fields before publication.
`validateUiEvidence` requires `trustedCapture` with those same fields, checks its controller against the base SHA and trees against authenticated build trees, then verifies build receipts and publishes images.
Missing capture context, contributor fixture hashes, replayed run attempts or source-run captures fail closed.
Dots independent signed acceptance must additionally require `uiCaptureVerified` and `sourceInputsVerified`.
A fixture change cannot authorize its own screenshot evidence; it needs independent protected or signed external capture.

## Source and build consistency

`assertCleanSnapshot` rejects staged or unstaged tracked drift, dirty submodules, changed gitlinks and nonignored untracked files.
Only generated tracked `COVERAGE.md` may differ.
Ignored build outputs remain subject to build inventory checks.
The build pipeline builds both Chrome and web, then records `dist/web/.autonomy-build.json` with web and installed-extension inventories:

```sh
node tools/autonomy/capture-ui.mjs --record-build /absolute/checkout FULL_SHA
```

The receipt binds the source SHA, tree SHA, complete web inventory and optional `extensionFiles` inventory with SHA-256 hashes.
Extension plans require both actual package bytes and a matching installed-extension inventory for both revisions.
The trusted capture runner compares candidate artifact bytes with the inventory and authenticated GitHub source tree without opening a candidate Git checkout or importing candidate code.
It verifies the protected before source and build bytes, and repeats checks after capture.
Missing receipts, changed or injected assets and symlinks fail closed.
Hashed copies of `before-build.json` and `candidate-build.json` are retained in the screenshot artifact.
Receipts establish consistency within the pipeline, while protected workflow authentication and signed independent acceptance establish the execution trust boundary.

## Publication and PR body

GitHub Actions artifacts are retained run evidence, not durable inline image URLs.
The protected adapter verifies image hashes and publishes the exact bytes directly with `gh pr edit --attach` and `--body-file`.
The CLI rewrites local image references in the body file into GitHub attachment URLs.
Repeat `--attach` for each file, with at most 50 attachments per command; larger manifests require bounded batches preserving author content and previously published images.
Feature-check `gh pr edit --help` for `--attach` at runtime and fail closed if unsupported.
The [official manual](https://cli.github.com/manual/gh_pr_edit) documents the flag; v2.102.0 is the latest release at the time of this change.
Attachment commands use `AUTONOMY_IMAGE_TOKEN` as their `GH_TOKEN`, separately from the pinned acceptance App token.
Use a fine-grained PAT restricted to this repository with PR edit permissions; the [official attachment client](https://raw.githubusercontent.com/cli/cli/trunk/internal/attachments/client.go) rejects `ghs_` installation tokens.
This secret belongs only in the protected-main `autonomy` environment and must never reach candidate execution.
The direct adapter stages PNGs and `--body-file` content under `os.tmpdir()`, batches at most 50 repeated `--attach` flags per command, and removes temporary files afterward.
Its attachment subprocess environment supplies only the separate `AUTONOMY_IMAGE_TOKEN` as `GH_TOKEN`, never the acceptance App token; missing `--attach` support and `ghs_` tokens are refused.
For each batch, it checks the bound SHA, current head, base and body before and after publication, reads back the PR body, and verifies the exact local-reference rewrites.
It independently downloads and hashes the attachments to bind authenticated `{ path, url, contentHash }` receipts to the verified capture.
Partial uploads fail closed without automatic retries; temporary-file cleanup does not undo remote uploads.
The acceptance App then patches the final bounded evidence section and alone posts `Autonomy / acceptance`.
The preferred URL is `https://github.com/user-attachments/assets/<attachment-id>`; allowlisted legacy GitHub attachment hosts are also accepted.
Repository `blob`/`raw` URLs, custom image hosts, and committed PNGs cannot satisfy this contract.
No external HTTP image publisher or endpoint is required.
The direct uploader has not been verified against a remote PR; CLI support, credential permissions, body rewriting and byte integrity need a real pilot before claiming publication is installed.
`validateScreenshotManifest` checks pairing and metadata.
Its strict options include `headSha`, `baseSha`, `body`, `impact`, `policy`, `readArtifact`, `publishedAssets` and optional `requiredSurfaces`.
Each PNG must match actual artifact bytes and exactly one trusted upload receipt.
Every declared required surface and policy theme/viewport must be present; web images cannot satisfy extension requirements.
URLs must be HTTPS on the mandatory base-policy host allowlist, without credentials, custom port, query or fragment, and must appear as exact inline Markdown images in the body.
Absent publication fails closed.

`renderBody(body, manifest, options)` returns a string and `updateUiEvidence` returns `{ body, changed }`.
Both preserve author content outside `<!-- autonomous-ui-evidence:start -->` and `<!-- autonomous-ui-evidence:end -->`, replace one bounded block and are idempotent.
Each image label includes surface, route, scenario, SHA, role, theme and viewport.
An optional authenticated GitHub Actions `runUrl` adds a run link.
Duplicate or unmatched markers fail closed.
Bodies are bounded at 60,000 UTF-8 bytes, manifests at 128 images and each image at 10 MB.
Before posting, trusted orchestration rechecks the current head, base and body to avoid stale updates or overwriting author edits.

Run infrastructure checks with `pnpm test:autonomy`.
Temporary Git repositories cover dirty sources, submodules and tampered build outputs.
No screenshot unit test can replace real coordinated browser execution.
