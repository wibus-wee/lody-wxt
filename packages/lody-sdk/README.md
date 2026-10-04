# @lody-mobile/sdk

Lody SDK for caller-controlled authentication, cloud discovery, session synchronization, Machine commands, schedules, MCP/skill discovery, synchronized prompt shortcuts, attachment transfer and static session sharing.
The package is currently private.
It ships ESM JavaScript and declarations in `dist`, plus explicit TypeScript source entry points.
Implemented adapters describe protocol behavior; they do not establish that a deployment or native runtime has been verified for production.

| Area                         | Public entry / owner                                                                                                                      | Responsibility                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity, workspaces, grants | `createLodyClient` from `@lody-mobile/sdk`; [client](./src/client.ts)                                                                     | Device authorization, account/organization reads and one Streams grant request per call.                                 |
| Cloud directory              | `BetterAuthConvexJwtProvider`, `ConvexCloudDirectory`; [cloud](./src/cloud)                                                               | Exchange a session bearer for a Convex JWT; query visible machines and local project identifiers.                        |
| Sessions                     | `SessionRuntime`, `LoroSessionRepository`; [sessions](./src/sessions)                                                                     | Persist and synchronize session metadata/history through repository ports; invoke commands through `MachineCommandPort`. |
| Loro composition             | `createLoroSessionRuntime` from `@lody-mobile/sdk/loro`; [composition root](./src/loro-runtime.ts)                                        | Wire storage, cursors, Streams auth and commands into session, Machine, schedule and MCP adapters.                       |
| Machine RPC                  | `StreamsMachineCommands` from the root; `JsonRpcStreams` from `@lody-mobile/sdk/rpc`                                                      | Correlate JSON-RPC commands and replies over Streams.                                                                    |
| Submission gateway           | `SessionSubmissionService`, `HttpSessionSubmissionGateway`; [gateway](./src/sessions/infrastructure/http-submission-gateway.ts)           | Submit or look up a server receipt using a caller-owned request UUID.                                                    |
| Attachments                  | `createAttachmentClient`, `AttachmentService`; [attachments](./src/attachments)                                                           | Upload files/images, download bytes and fetch bounded text previews.                                                     |
| Schedules                    | `ScheduleRepository`, `ProtocolScheduleRepository`; [schedules](./src/schedules)                                                          | Synchronize definitions, registry requests and machine-reported runtime state; preview trigger times.                    |
| MCP catalog                  | `WorkspaceMcpCatalog` from `@lody-mobile/sdk/loro`; [catalog](./src/workspaces/infrastructure/workspace-mcp-catalog.ts)                   | Read workspace server summaries without exposing connection credentials; selection travels in turn input.                |
| Skills                       | `SessionRuntime.listSkills`, `skillResultSchema`; [protocol](./src/sessions/infrastructure/skills-protocol.ts)                            | Discover global or project skills through the target machine's existing RPC.                                             |
| Prompt shortcuts             | `PromptShortcutRuntime`, `LocalShortcutStore`, `PromptShortcutSync`, `ConvexPromptShortcuts`; [shortcuts](./src/shortcuts)                | Synchronize authorized private/workspace catalogs and immutable bodies; preserve local edits and publication recovery.   |
| Static sharing               | `ShareManagementPort`, `ConvexShareManagement`, `prepareSharePackage`, `uploadPreparedShare`, `openStaticShare`; [sharing](./src/sharing) | Capture bounded packages, manage publication and credentials, upload sealed objects and read a fixed deployment.         |
| Offline bridge               | `OfflineDataRuntime`; [documents](./src/documents)                                                                                        | Import/read/export documents through a caller-owned isolated engine host.                                                |
| Shared contracts             | [shared](./src/shared)                                                                                                                    | Clock, request options, primitive rules and the identity/workspace/grant HTTP pipeline.                                  |

## Architecture and ownership

Each context separates domain rules/models, application services/ports and infrastructure adapters.
Domain and application modules do not import external packages.
Domain modules depend only on domain modules; application modules depend on domain and application ports.
Infrastructure owns Valibot schemas, HTTP, Streams, Loro/Flock and bridge libraries.
Composition roots select and wire adapters.
Schedules, sharing and prompt shortcuts are independent contexts; MCP discovery belongs to workspaces, and skill discovery belongs to sessions.
The Loro composition root wires session, schedule and workspace adapters to the same caller-configured repository and lifetime.
Sharing composes separately through explicit HTTP origins and credential providers.
Prompt shortcuts require a separate caller-owned repository with no workspace transport, plus resource-specific grants; they are not part of `createLoroSessionRuntime`.
The only permitted direct dependency between contexts remains Streams → the workspace identifier domain value.
Schedules use shared lifecycle helpers without importing session infrastructure; shared modules never import a context. [Architecture checks](./test/architecture.test.mjs) enforce these import boundaries and reject cycles.

Credentials, secure storage, grant caching, drafts, mutation journals, session admission progress, recovery policy, React state, browser navigation and account lifecycle belong to the caller.
This includes schedule operation identities and sharing secrets, frozen package bytes, deployment receipts and revision checks.
Shortcut working copies and their publication journal are the exception: `LocalShortcutStore` manages that protocol inside the caller-supplied repository; the caller still owns durable storage and account isolation.
The SDK owns protocol validation, request correlation and persistence/synchronization ordering.
Network and storage adapters perform explicit caller-requested I/O; domain rules remain dependency-free.
SDK application ports do not depend on React, WXT or device storage.
The Loro composition root accepts a storage adapter and remote cursor store; it does not choose their implementation or manage their account namespace.
SDK calls must use explicitly configured origins and credentials.
No adapter substitutes an endpoint, document, receipt or successful result after a protocol failure.

The root entry exposes services and selected adapters. `@lody-mobile/sdk/loro` owns `createLoroSessionRuntime`; `@lody-mobile/sdk/rpc` owns `JsonRpcStreams`.
The corresponding `/source`, `/loro/source` and `/rpc/source` entries expose TypeScript for toolchains configured to transform it.
Other package subpaths are private.
The Loro repository adapter is exported from `@lody-mobile/sdk/loro`.
Separate entry points are not a guarantee about bundle size or platform compatibility.

## Identity and Streams grants

```ts
import { createLodyClient } from '@lody-mobile/sdk';

declare const authOrigin: string;
declare const clientId: string;
declare const openAllowedVerificationUrl: (url: string) => Promise<void>;

const client = createLodyClient({ authOrigin, clientId });
const controller = new AbortController();
const options = { signal: controller.signal };
const authorization = await client.identity.requestDeviceCode(options);
await openAllowedVerificationUrl(authorization.code.verification_uri_complete);
const token = await client.identity.waitForDeviceToken(authorization, options);
const account = await client.identity.getAccount(token.access_token, options);
const workspaces = await client.workspaces.list(token.access_token, options);
void account;
void workspaces;
```

Supply an HTTPS origin with no path, query, fragment or embedded credentials and a client ID registered for your deployment.
The caller must apply its browser-origin allowlist before opening either returned verification URL; both URLs are validated as HTTPS without embedded credentials.
The SDK does not open a browser, select a workspace, save tokens or sign out.
Grouped methods are preferred; the flat methods returned by `createLodyClient` are aliases.

Before authenticated calls, read credentials from the caller's secure store.
Persist newly authorized credentials only if the flow still belongs to the active account.
On logout or account switch, abort the old context and fence late responses.
An `unauthenticated` error may invalidate the failing credential if it is still current; `forbidden` may indicate workspace access denial.
Network errors do not justify deleting credentials.
Account/session objects, token responses and future protocol fields may contain secrets or personal data; do not log them.

`client.streams.getGrant(token, workspaceId, options)` performs one POST per invocation, including concurrent calls. `options.rejectedToken` supports explicit rejection of a previous grant.
The server's `expiresIn` is in seconds.
The caller owns cache isolation by endpoint/workspace/credential generation, refresh coalescing, expiry margins and rejected-token comparison.
Missing `gatewayBaseUrl` or `shardHostSuffix` remains missing; configure routing from the deployment contract before constructing a data adapter.

The default ofetch transport uses global `fetch`, disables retries, omits cookies and rejects redirects.
Injected `HttpTransport` must honor abort and redirect policy and must not log credentials or bodies.
HTTP requires standard URL, Headers, AbortController, timers and `performance.now` APIs.

`requestTimeoutMs` defaults to 15,000 ms; per-call `timeoutMs` bounds transport and JSON decoding together.
Device polling additionally uses the original authorization deadline, including an in-flight exchange. `expiresAtMs` is in the configured clock's millisecond domain, not epoch time: do not persist it or transfer it between clients with different clocks. `Clock.now` must be nondecreasing; `Clock.sleep` must reject and release its timer when aborted.

Polling waits the advertised interval before the first exchange. `authorization_pending` continues; each `slow_down` permanently adds five seconds.
Other failures stop polling without automatic retry.
Custom pollers using `requestDeviceToken` own interval and slowdown handling and must not extend the deadline. `LodySdkError` exposes the [bounded codes](./src/shared/domain/errors.ts) and optional HTTP status, without retaining raw responses or transport causes.
Device errors are interpreted only from successful responses or HTTP 400; other HTTP failures cannot become pending or authorized.

## Cloud discovery

```ts
import { BetterAuthConvexJwtProvider, ConvexCloudDirectory } from '@lody-mobile/sdk';

declare const authOrigin: string;
declare const convexUrl: string;
declare const workspaceId: string;
declare const getSessionBearer: (signal?: AbortSignal) => Promise<string>;

const jwt = new BetterAuthConvexJwtProvider({ authOrigin, getSessionBearer });
const directory = new ConvexCloudDirectory({ convexUrl, jwt });
const machines = await directory.listMachines(workspaceId);
const projects = await directory.listLocalProjects(workspaceId);
void machines;
void projects;
```

`authOrigin` and `convexUrl` are separate explicit HTTPS origins.
The JWT adapter calls `/api/auth/convex/token` with the caller's session bearer.
The directory calls the Convex deployment's `/api/query` with that JWT, using `machines:listVisibleMachines` and `localProjects:listVisibleLocalProjects`.
A device/session bearer is not a substitute for a Convex JWT.
JWT syntax validation does not verify signature or authorization locally; the server remains authoritative.
Directory rows identify visible machines/projects; agent configurations and capabilities come from Machine Flock data.
Organization rows from `client.workspaces.list` are not role-enriched Convex workspace summaries.

Both adapters omit cookies and use abort signals, with a default 15,000 ms timeout.
Directory calls accept `RequestOptions`; the JWT exchange has its own configured timeout.
These adapters rely on credential providers and fetch/body decoding honoring the supplied signal. `CloudError` carries a code and status for configured/protocol failures; validation, fetch and abort errors may propagate directly.
There is no uniform `LodySdkError` conversion, JWT cache, automatic retry or credential mutation.

## Session runtime and Loro

`SessionRuntime(repository, commands)` coordinates the `SessionRepository` and `MachineCommandPort` ports.
It creates/lists/patches sessions, opens readable/subscribable handles, sends dispatch or queued turns, responds to permissions and issues stop, steer, fork, edit-and-resend and capability-refresh commands.
Each steering call issues one RPC and returns its protocol result.
The caller composes session creation with its first turn and owns admission progress and recovery.
Implement these ports to use another storage or command transport without importing those adapters into application code.

```ts
import type { MachineCommandPort, SendTurn, SessionMetadata } from '@lody-mobile/sdk';
import type { LoroRuntimeOptions } from '@lody-mobile/sdk/loro';
import { createLoroSessionRuntime } from '@lody-mobile/sdk/loro';

declare const workspaceId: string;
declare const streamsBaseUrl: string;
declare const auth: LoroRuntimeOptions['auth'];
declare const storageAdapter: LoroRuntimeOptions['storageAdapter'];
declare const documentRemoteCursorStore: LoroRuntimeOptions['documentRemoteCursorStore'];
declare const commands: MachineCommandPort;
declare const metadata: SessionMetadata;
declare const input: SendTurn;

const connection = await createLoroSessionRuntime({
  workspaceId,
  streamsBaseUrl,
  auth,
  storageAdapter,
  documentRemoteCursorStore,
  commands,
});
try {
  await connection.runtime.createSession(metadata);
  const receipt = await connection.runtime.send(metadata.id, input);
  const handle = await connection.runtime.openSession(metadata.id);
  try {
    const snapshot = handle.read();
    void snapshot;
    void receipt;
  } finally {
    await handle.close();
  }
} finally {
  await connection.close();
}
```

Configure a confirmed HTTPS Streams base URL and auth provider.
The composition root uses bucket `lody`, workspace metadata stream `${workspaceId}:meta`, session stream `${workspaceId}:s:${sessionId}` and Machine Flock stream `${workspaceId}:mf:${machineId}`.
It creates LoroRepo, installs Streams transport and snapshot compression, then waits for initial metadata synchronization with a 30,000 ms bound.
It returns `runtime`, `machines`, `schedules`, `mcpCatalog`, `repo` and `close`; retain the connection and close it to abort pending adapter waits and release runtime handles, Machine subscriptions, the metadata subscription and repository.
Schedule and MCP operations acquire and release their own document leases within that connection lifetime.

The Loro repository validates metadata/history at its boundary, serializes writes within an open session and persists document state before awaiting synchronization and publishing dispatch metadata. `send` appends and flushes, returning `{sessionId, turnId: input.requestId, state: 'synced'}`. **`synced` does not mean the Agent accepted, started or finished a task.** Observe history and session state separately.
Queued sends write Lody's `mq` movable list with stable `userTurnId` and `operationId`, then synchronize before publishing `messageQueueUpdatedAt`.
Snapshots expose these records as `queue`, separately from `history`.
Retries reuse the queue row or its promoted history entry; conflicting content rejects.
Rows created by older clients in history remain history and are not automatically moved or replayed.
The optional repository/composition `now` supplies epoch milliseconds for queue notifications; use a server-calibrated clock when available.
Notifications advance past the observed queue watermarks.
A user turn's `finished` field is not proof of assistant completion.
Permission outcomes synchronize document changes; a stop RPC requests cancellation but does not prove execution has stopped.

To steer, the caller appends a guide turn and flushes its session handle before invoking `runtime.steer`.
The caller interprets the returned disposition, chooses whether to retry with the same identity, promote the guide through `handle.promote`, or reconcile history.
The SDK does not automatically retry or convert a steering command into a queued turn.
The WXT application's [session flows](../../src/features/conversations/session-flows.ts) own those decisions and retain session admission progress.
Preserve the guide turn identity after failure; delivery/recovery results do not establish assistant completion.

Keep `requestId`, timestamp, user ID and input configuration stable when recovering an uncertain send.
Repeating an existing turn ID with matching content does not append a second history entry; conflicting content rejects with `request_conflict`.
This is document-level duplicate handling, not an end-to-end exactly-once execution guarantee.
Creating an existing session with matching identity waits for metadata synchronization; conflicting identity rejects with `session_conflict`.
Repeated sends still confirm history synchronization before publishing dispatch metadata.
Repeated matching permission outcomes still persist and synchronize the outcome.
A timeout after persistence can leave a write that later synchronizes; reconcile the same session/turn before creating a new identity.

Opened session and Machine Flock handles own subscriptions/leases; unsubscribe listeners and close handles when leaving their scope.
Session reads expose snapshots and unknown protocol extensions, not a complete business-state projection.
Machine Flock exposes agent configurations, projects and capabilities.
Matching `acpModelCapability` source versions supply `declaredModelControls`; stale declarations are not merged, and malformed declarations reject.
Model option selection and defaults belong to the caller.
Archive/delete helpers synchronize command records and do not confirm that the machine completed them.
Session repository waits default to 30,000 ms and can be configured with a repository lifetime signal.
Repository close aborts its waits.
Session methods do not all accept per-call cancellation; command methods accept a signal.
Cancellation/deadline limits waiting and does not roll back persisted CRDT state or interrupt a remote Agent.

## Machine RPC

```ts
import { StreamsMachineCommands } from '@lody-mobile/sdk';
import type { LoroRuntimeOptions } from '@lody-mobile/sdk/loro';
import { JsonRpcStreams } from '@lody-mobile/sdk/rpc';

declare const workspaceId: string;
declare const streamsBaseUrl: string;
declare const auth: LoroRuntimeOptions['auth'];

const streams = new JsonRpcStreams({ baseUrl: streamsBaseUrl, auth });
const commands = new StreamsMachineCommands({ workspaceId, streams });
void commands;
```

The transport ensures JSON streams with a one-day TTL; an existing incompatible stream rejects.
Requests use `${workspaceId}:rpc:req:${machineId}`, replies use `${workspaceId}:rpc:res:${machineId}`.
Commands subscribe from the current stream position and wait for subscription readiness before appending a JSON-RPC 2.0 envelope with `rpcVersion: '1'`, caller request ID, reply destination, `sentAt` and `expiresAt`.
Replies are correlated by ID; unrelated IDs are ignored.

The [command adapter](./src/sessions/infrastructure/streams-machine-commands.ts) validates supported method parameters and method-specific results, including the session and turn identities corresponding to the request.
Fork replies must match both source and target session IDs.
RPC completion and metadata synchronization are separate: the caller must observe the target in synchronized session metadata before opening or selecting it.
Capability refresh validates machine/config identities and distinguishes binary progress from the final response.
Progress keeps the request pending and renews its silence deadline; final failure results retain their `success: false` and error fields for the caller.
Default command silence timeout is 30,000 ms.
A caller AbortSignal can impose a total deadline across progress notifications.
The signal controls reply subscription/waiting, but stream ensure/append operations do not accept it; a deadline does not guarantee every underlying transport operation has stopped.
Remote errors reject; the port's return type remains `unknown` and callers must interpret success/disposition fields.
Validation, abort and transport errors are not a stable SDK-wide code hierarchy.
Persist request identities when command delivery is uncertain; the adapter supplies no durable command journal or general retry/server deduplication guarantee.
Steering recovery belongs to the caller, as described above.
This protocol is separate from the offline birpc bridge.

## MCP and skill discovery

`connection.mcpCatalog.list()` returns `WorkspaceMcpServer[]` after initial synchronization of the workspace Flock document `${workspaceId}:wf:workspace`.
Rows contain ID, name, transport, optional description, `enabledByDefault` and `hasConnection`; connection URLs, commands, environment variables and authorization headers remain inside the adapter.
The catalog validates identity and transport consistency, releases its lease after each read and exposes no install, authorization or mutation API.

The caller chooses defaults and passes selected IDs through `TurnInput.mcpServerIds` or `SessionSubmission.mcpServerIds`.
Omission and an explicit empty array remain distinct inputs.
Preserve the selection with the rest of the immutable payload through dispatch, queue, edits and recovery; a conflicting same-ID send rejects.
A catalog row establishes configured availability, not successful connection or agent compatibility.
The machine's ACP initialization determines supported transports and resolves its environment.
This catalog does not establish a browser-control bridge or authorize access to browser tabs.

`runtime.listSkills(machineId, workspaceId, requestedByUserId, requestId, project?, signal?)` uses `local-project/control` RPC.
With `{localProjectId, skillDirs}`, it requests `local-project/list-skills`; otherwise it requests `local-project/list-global-skills`.
The command adapter validates responses with the exported `skillResultSchema`; a custom `MachineCommandPort` still returns `unknown`, so callers must validate its result.
Groups retain scope, directory, truncation and error information; a partial discovery failure must remain visible.
Discovery does not install or execute a skill.
Choosing a skill and including its invocation in a user-visible prompt belong to the host application.

## Prompt shortcuts

The root exports `PromptShortcutRuntime`, `LocalShortcutStore`, `PromptShortcutSync` and `ConvexPromptShortcuts` with their [models](./src/shortcuts/domain/models.ts) and [ports](./src/shortcuts/application/ports.ts).
These implement Lody's synchronized prompt shortcuts independently of machine slash commands and skills.
`parsePromptShortcut` validates the bounded prompt, coherent UTF-16 mention ranges and explicit project/machine/provider scope; `resolveShortcutAvailability` combines that scope with caller-provided dependency availability.
Selecting a shortcut and applying its text/mentions to a composer are caller responsibilities.

The caller creates an isolated repository with `createPromptShortcutRepo({storageAdapter})` from `@lody-mobile/sdk/loro`, then calls `LocalShortcutStore.open({repo, workspaceId, userId})`.
The factory uses the SDK's LoroRepo implementation and requires the caller's account/workspace-scoped storage adapter.
Opening rejects a repository that already has a transport.
Never attach the session workspace transport to this repository: its working-copy bodies, discovery cache and publication ledger must remain local.
The SDK chooses neither a database nor browser storage; the caller owns repository creation, persistence policy, credential lifetime and serialized close/reopen on identity changes.

Construct `ConvexPromptShortcuts({origin, workspaceId, userId, getJwt, fetch?, timeoutMs?})` with an explicit Convex origin and JWT provider.
`listAccessibleDocuments(options?)` returns authorization pointers through `promptShortcuts:listAccessibleDocuments`; call `runtime.setDirectory(rows)` after initial query and subsequent refreshes.
The caller schedules directory refresh/retry; the SDK does not open a Convex reactive subscription.
`getStreamToken(resource, write, options?)` invokes the `promptShortcuts:getStreamToken` action with the requested index owner/visibility or body ID.
The returned grant binds `token`, `expiresIn`, `gatewayBaseUrl` and exact `streamId`.
Private indexes are owner-only; other workspace members may read shared indexes but cannot write them.
The server authorizes body resources, including staged-owner-only writes and immutable published bodies.

`PromptShortcutSync({repo, grant, now})` acquires those individual index/body grants and validates resource identity on acquisition and renewal.
Its resources are `shortcut-index:${encodedWorkspaceId}:${encodedOwnerId}:${visibility}` and `shortcut-body:${encodedBodyId}`, outside the workspace stream prefix.
Workspace grants cannot substitute for these credentials.
Read-only adapters suppress local update traffic, and cursors remain in memory so a restart replays against the persisted replica.
Combine sync's `acquire`/`dispose` with the cloud adapter's `stage`, `activate`, `settle` and `revoke` to implement `ShortcutPublicationPort`, then construct `PromptShortcutRuntime(store, publicationPort)`.

The runtime exposes `getSnapshot`, `subscribe`, `read(entry)`, `save({value, base, bodyDocId})`, `remove(entry)`, `prefetch`, `flush`, `retry` and `dispose`.
Snapshots distinguish entries, pending IDs and errors. `save` resolves after local persistence; publication runs separately, and that resolution is not proof of cloud synchronization.
The directory controls remote access, while live Flock indexes supply display metadata; directory revocation hides cached entries before network work and prevents subsequent cached-body reads.
Bodies must match the indexed revision.
Concurrent document heads remain an explicit conflict; they are never collapsed into a field-wise prompt/mention mixture.

Before network publication, the store persists a frozen body and immutable publication record separate from the editable working copy.
Publication stages the body identity, uploads/synchronizes it, activates it with the previous body/revision as conflict preconditions, then publishes the index.
Visibility changes require a fresh body and withdraw the old index projection.
An uncertain job retains the same body/revision and is retried or settled before newer edits publish; deleting a shortcut revokes its bodies and tombstones both visibility domains.
The local store's ledger uses the injected persistence adapter; the caller must retain that storage across reconnects and never replace a pending job with a newly generated identity.
On account/workspace changes, fence credentials and UI immediately, await `runtime.dispose()`, then destroy the caller-owned repository.
Cancellation stops local waiting and does not undo a server mutation.

## Schedules

`connection.schedules` implements the root-exported [ScheduleRepository](./src/schedules/application/ports.ts): `list()`, `runtimeRows()`, `read(scheduleId)`, `save(input)`, `setEnabled(input)`, `delete(scheduleId, actorId, now)` and `requestRun(input)`.
For another storage transport, construct `ProtocolScheduleRepository` with a `ScheduleStorage` implementation.
The Loro adapter synchronizes `${workspaceId}:schedule:${scheduleId}` documents and the `${workspaceId}:sr` Flock registry.

The [schedule models](./src/schedules/domain/models.ts) define agent/project selection, destination, trigger, misfire, overlap and dispatch retry policies.
`validateScheduleTrigger(raw)` validates manual, once, interval and five-field cron triggers; `previewSchedule(trigger, activeFrom, now, count?)` returns future epoch-millisecond times using the upstream Croner semantics and explicit cron time zone.
A preview does not register timers or execute jobs.
Before enabling or requesting execution, the caller must verify that the chosen machine advertises `protocolCapabilities.schedules >= 1`; the repository does not discover that capability itself.

`save` checks ownership, persists and synchronizes the definition and prompt, then publishes the fingerprinted registry row.
Deletion publishes a tombstone while retaining the document.
These are ordered writes across separate documents, not a transaction: a timeout can leave the definition persisted before registry publication.
Journal the complete mutation arguments before writing, including schedule/activation/activity/request IDs, actor, timestamps and draft, and recover with those same values.
Do not allocate a new activation or manual-run ID to resolve an uncertain write.
Machine-written `runtimeRows()` are authoritative for observation, queue state and dispatch; a successful request write does not establish that the machine ran the schedule.

## Static session sharing

Sharing separates authenticated management, binary transfer and public reading.
Configure each origin explicitly; the SDK supplies no production deployment defaults.
`ConvexShareManagement({origin, getJwt, fetch?, timeoutMs?})` implements [ShareManagementPort](./src/sharing/application/ports.ts) against the Convex `sessionSharing:*` query/mutation functions.
Its methods are paginated `list`, `getManagement`, `beginDeployment`, `publishDeployment`, `resetCredential` and `revoke`.
Management uses a Convex JWT; uploads use a separate upload secret, and public reads use the reader secret.
Neither transfer nor reader calls receive the account credential.

`prepareSharePackage({rootSourceId, conversations, capturedAt, readAttachment, ...})` captures caller-supplied readable history before attachment I/O and returns a detached `PreparedSharePackage`: manifest, manifest bytes/hash, object bytes and source-ID mappings.
The exporter removes live execution configuration and known credential fields, preserves visible user text, remaps source identities and copies only typed attachment references through the supplied callback.
Opaque tool content remains inert display data; preparation is not a guarantee that user-authored text contains no secrets.
The caller must preview the actual prepared package and obtain publication confirmation.
The current transfer policy permits copied images and omits binary files.
Limits bound conversations, attachments, object bytes, total bytes and decoded history; invalid references, hashes or compressed content reject.
`verifyShareObject`, `decodeShareHistoryBytes`, `validateShareHistory` and `validateShareManifest` are public helpers for inspecting that same package without rereading a changing live conversation.

The publication sequence is capture/confirm, `beginDeployment`, `uploadPreparedShare({origin, deploymentId, secret, prepared, ...})`, then authenticated `publishDeployment(deploymentId)`.
Upload validates immutable object hashes, transfers the objects and seals the manifest; the upload credential cannot publish.
Before the first mutation, the caller must durably retain the confirmed package, source mappings, request ID, expected revision, reader/upload secrets and configured origins.
Save the returned deployment identity before transfer, and retain the reader secret before publishing.
After uncertain delivery, query management and reconcile the same request/deployment, bytes and credentials rather than recapturing current history or generating new secrets.
Reset and revoke require the observed revision.
A changed management revision alone does not prove that an uncertain reset installed this caller's secret; verify that secret through a public read before accepting recovery.

`createSessionShareSecret`, `hashSessionShareSecret` and `createSessionShareUrl(shareId, secret, origin)` provide credential generation, hashing and a public-reader URL with its secret in the fragment.
`openStaticShare({origin, shareId, secret, signal?, fetch?})` resolves the active deployment once; its history, attachment and object reads stay pinned to that deployment and verify object integrity.
The HTTP adapters omit cookies and reject redirects.
Management has a default 30,000 ms deadline.
Each data-plane request has a 120,000 ms bound; supply a caller signal to cancel or bound the entire multi-request operation.
A successful revoke must be confirmed by management; a failed public read on its own can also be a network failure and is not proof of revocation.
The caller owns secret retention/deletion, journal isolation across account/workspace/origin changes and lifecycle cancellation.
These operations provide no automatic retry or durable browser storage.

## HTTP submissions and recovery

Construct `SessionSubmissionService` with `HttpSessionSubmissionGateway({convexSiteUrl, auth})`.
Supply the deployment's explicit HTTPS site origin and an `AuthTokenProvider`; the gateway does not infer the site origin from the Convex query origin.
It POSTs `/api/workspaces/{workspaceId}/session-submissions` and looks up a request through GET on the same path plus `/{requestId}`.

The caller creates and journals a request UUID with its immutable submission payload before sending.
The gateway normalizes UUIDs to lowercase and limits serialized JSON to 256 KiB.
After uncertain delivery, use `lookup(workspaceId, requestId)` and retain the same ID/payload for recovery; a new ID can create another submission.
Lookup returns `null` for HTTP 404.
Receipts require matching request/turn IDs and contain `pending`, `submitted` or `unconfirmed`; none establishes Agent completion.
Idempotency beyond receipt identity is a server contract, not a local exactly-once guarantee.

Timeout defaults to 15,000 ms and can be overridden with `RequestOptions`.
Auth/fetch/body decoding must honor the signal. `SubmissionError` carries code/status for gateway checks and server failures; fetch, JSON and abort errors may propagate directly.
No retry, fallback receipt or caller-journal persistence is provided.

## Attachments

```ts
import { createAttachmentClient } from '@lody-mobile/sdk';

declare const attachmentOrigin: string;
declare const getToken: (signal?: AbortSignal) => Promise<string>;
declare const workspaceId: string;
declare const sessionId: string;
declare const blob: Blob;
declare const fileName: string;

const attachments = createAttachmentClient({ origin: attachmentOrigin, auth: { getToken } });
const file = await attachments.uploadFile({
  workspaceId,
  sessionId,
  blob,
  fileName,
  textPreview: true,
});
void file;
```

Supply an explicit HTTPS origin for the attachment endpoint and a caller-owned auth provider. `AttachmentService` validates inputs before invoking its gateway.
Workspace/session/attachment identifiers use 1–128 ASCII word or hyphen characters.
Sources are nonempty `Blob`s with filenames.
Files are limited to 100 MiB; up to 8 PNG/JPEG/WebP/GIF images may be uploaded per call, each at most 5 MiB.
Image MIME types and any filename extension must be supported; this is not image-content verification.

Files up to and including 16 MiB use a single upload; larger files use sequential 16 MiB multipart parts followed by completion.
The adapter computes incremental SHA-256 and validates returned hash, size and multipart file ID.
It accepts the schema-validated server filename, which may be normalized or truncated by the service.
Images upload sequentially as individual FormData requests.
Returned attachment metadata can be used in session input blocks; upload storage may use a separate session ID, represented by optional `storageSessionId` where the consuming contract supports it.
Uploading bytes does not dispatch a turn.

Requests omit cookies, reject redirects and do not automatically retry. `AttachmentRequestOptions` supplies `signal`, `timeoutMs` and progress callbacks; default transfer timeout is 30,000 ms across credential acquisition, preparation and transfer.
A file multipart failure with a known upload identity attempts DELETE cleanup under a separate default 5,000 ms deadline using the transfer credential, even when the caller has cancelled.
Cleanup failure throws `AttachmentCleanupError`, retaining both `transferError` and `cleanupError`.
Treat these retained errors as potentially sensitive when using injected providers/adapters.

Cleanup is partial: it cannot remove an upload whose identity was never received, undo a completed single upload, or roll back earlier images if a later image fails.
Cancellation does not prove the server discarded bytes.
The caller owns orphan reconciliation and retention policy; no completed-attachment deletion API or atomic image batch is exposed.
Attachment errors distinguish invalid input/configuration, cancellation, timeout, network/HTTP/protocol failures, auth denial and integrity mismatch.

Downloads return a `Blob` with a protocol size bound; they do not verify the download's hash against an uploaded file.
Text preview requests at most the first 1 MiB, enforces the bound even if the server ignores Range, decodes UTF-8 and reports `fetchedBytes`/`truncated`.
Downloads/previews buffer their bounded result.
This adapter requires Blob, FormData, Headers, readable response streams and text encoding APIs; verify these in each target runtime.

## Offline document bridge

`OfflineDataRuntime` composes `OfflineDocumentService` with birpc and a caller-provided `DataHost`.
It is an independent import/read/export bridge; it does not provide cloud synchronization or Machine RPC.
Host engine support and licensing are the host integrator's responsibility.

```ts
import type { DataHost } from '@lody-mobile/sdk';
import { encodeBinary, OfflineDataRuntime } from '@lody-mobile/sdk';

declare const host: DataHost;
declare const snapshot: Uint8Array;

const runtime = new OfflineDataRuntime(host);
try {
  await runtime.ready;
  await runtime.data.open({ documentId: 'session', kind: 'loro' });
  await runtime.data.import({ documentId: 'session', bytes: encodeBinary(snapshot) });
  const state = await runtime.data.read({ documentId: 'session' });
  void state;
} finally {
  runtime.dispose();
}
```

One unused host belongs to one runtime.
Construction starts the host immediately; await `ready` before calls or subscriptions.
Protocol 3 fences messages by runtime instance.
Initialization defaults to 15,000 ms; disposal is idempotent, rejects pending work, releases listeners/timers and calls host disposal.
Recovery requires a new runtime and host.

`data` exposes `open`, `import`, `read` and `export`.
Binary fields use canonical padded base64, limited to 1 MiB decoded per binary and 2 MiB UTF-8 per message. `read` returns `{kind, value, version, revision}` with raw value `unknown`; `export` returns bytes/version and accepts a previous opaque version for incremental export.
Outbound calls validate document IDs, operation arguments and binary limits before transport.
Invalid caller input rejects only that call and leaves other pending calls and the host active.
The host owns engine format and supported operations.
The SDK does not decode Streams framing.
Optional second-argument AbortSignal stays local, never crosses the bridge and cannot roll back an executed import. birpc owns its default 60,000 ms call timeout; at most 64 calls may be pending.
There is no per-call timeout override.

`subscribe(documentId, listener)` has no initial replay, suppresses duplicate/nonincreasing revisions and isolates listener exceptions.
Read current state separately.
Unsubscribe stops local delivery.
Correlated invalid results reject the matched call; invalid transport envelopes terminate the runtime.
Stale-instance and settled responses are discarded.
Runtime failures are ordinary errors and birpc diagnostics, not `LodySdkError` codes; do not parse library diagnostics as a stable code API.

## Build and verification

```sh
pnpm --filter @lody-mobile/sdk build
pnpm --filter @lody-mobile/sdk typecheck
pnpm test:sdk
pnpm test:sdk:package
```

Build clears generated `dist` and emits ES2022 ESM/declarations with TypeScript 7. `prepack` builds before packaging.
Root build commands build the SDK before consuming it; source-entry consumers must configure their own TypeScript/bundler pipeline.

[Protocol regression tests](./test/upstream-protocol.test.mjs) cover Lody queue layout and notification ordering, progress/final RPC responses, and versioned model capability rows.
The [shortcut](./test/shortcuts.test.mjs), [schedule](./test/schedules.test.mjs), [MCP catalog](./test/mcp-catalog.test.mjs), [skill RPC](./test/skills-protocol.test.mjs) and [sharing](./test/sharing.test.mjs) tests cover their protocol boundaries and recovery/integrity rules.
Their source baseline is the vendored Lody protocol; runtime adapters remain independent of the vendor checkout.
[SDK tests](./test) use Node's test runner, fake HTTP/Streams ports, controlled clocks and real local CRDT operations. [Package smoke](../../scripts/sdk-package-smoke.mjs) packs the SDK into an isolated consumer and checks runtime imports, declarations and private-path rejection.
The [upstream compatibility probe](../../tools/sdk/verify-upstream.mjs) loads an installed Lody OSS checkout's real Mirror/schema and RPC validators:

```sh
node --import tsx tools/sdk/verify-upstream.mjs /path/to/lody-oss
```

Run it from the workspace root after building the SDK; the supplied checkout must have its dependencies installed.
It checks queue interoperability and progress/final response handling and reports the tested upstream revision.
These checks are verification entry points, not a statement that they currently pass or that live cloud, Machine, attachment service, native fetch/WASM, persistence durability or production lifecycle behavior has been exercised.
See the repository's [architecture](../../docs/content/architecture.mdx) and [testing scope](../../docs/content/testing.mdx) for integration ownership and evidence boundaries.
