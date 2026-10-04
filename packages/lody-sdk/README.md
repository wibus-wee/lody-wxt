# @lody-mobile/sdk

Lody SDK for caller-controlled authentication, cloud discovery, session synchronization, Machine commands and attachment transfer.
The package is currently private.
It ships ESM JavaScript and declarations in `dist`, plus explicit TypeScript source entry points.
Implemented adapters describe protocol behavior; they do not establish that a deployment or native runtime has been verified for production.

| Area                         | Public entry / owner                                                                                                            | Responsibility                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity, workspaces, grants | `createLodyClient` from `@lody-mobile/sdk`; [client](./src/client.ts)                                                           | Device authorization, account/organization reads and one Streams grant request per call.                                 |
| Cloud directory              | `BetterAuthConvexJwtProvider`, `ConvexCloudDirectory`; [cloud](./src/cloud)                                                     | Exchange a session bearer for a Convex JWT; query visible machines and local project identifiers.                        |
| Sessions                     | `SessionRuntime`, `LoroSessionRepository`; [sessions](./src/sessions)                                                           | Persist and synchronize session metadata/history through repository ports; invoke commands through `MachineCommandPort`. |
| Loro composition             | `createLoroSessionRuntime` from `@lody-mobile/sdk/loro`; [composition root](./src/loro-runtime.ts)                              | Wire caller-provided storage, remote cursors, Streams auth and commands into LoroRepo; expose Machine Flock data.        |
| Machine RPC                  | `StreamsMachineCommands` from the root; `JsonRpcStreams` from `@lody-mobile/sdk/rpc`                                            | Correlate JSON-RPC commands and replies over Streams.                                                                    |
| Submission gateway           | `SessionSubmissionService`, `HttpSessionSubmissionGateway`; [gateway](./src/sessions/infrastructure/http-submission-gateway.ts) | Submit or look up a server receipt using a caller-owned request UUID.                                                    |
| Attachments                  | `createAttachmentClient`, `AttachmentService`; [attachments](./src/attachments)                                                 | Upload files/images, download bytes and fetch bounded text previews.                                                     |
| Offline bridge               | `OfflineDataRuntime`; [documents](./src/documents)                                                                              | Import/read/export documents through a caller-owned isolated engine host.                                                |
| Shared contracts             | [shared](./src/shared)                                                                                                          | Clock, request options, primitive rules and the identity/workspace/grant HTTP pipeline.                                  |

## Architecture and ownership

Each context separates domain rules/models, application services/ports and infrastructure adapters.
Domain and application modules do not import external packages.
Domain modules depend only on domain modules; application modules depend on domain and application ports.
Infrastructure owns Valibot schemas, HTTP, Streams, Loro/Flock and bridge libraries.
Composition roots select and wire adapters.
The declared context dependency is Streams → the workspace identifier domain value; shared modules never import a context. [Architecture checks](./test/architecture.test.mjs) enforce import direction, context boundaries and cycles.

Credentials, secure storage, grant caching, drafts, submission journals, session admission progress, steering recovery policy, React state, browser navigation and account lifecycle belong to the caller.
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
It returns `runtime`, `machines`, `repo` and `close`; retain the connection and close it to release the metadata subscription and repository as well as runtime handles.

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
