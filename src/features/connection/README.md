# Workspace connections

The extension service worker owns the workspace SDK connection.
An authorized stored account starts synchronization without opening a panel.
The browser preview continues to create its SDK connection in the page.

| Owner                                                | Responsibility                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [background-workspace.ts](./background-workspace.ts) | Validate stored identity and workspace membership, refresh grants, own the SDK replica and prepare the machine catalogue.                  |
| [background-lifecycle.ts](./background-lifecycle.ts) | Register startup, storage, permission, alarm and trusted extension port listeners; isolate and release each port's leases.                 |
| [background-protocol.ts](./background-protocol.ts)   | Declare and validate the finite RPC methods and JSON messages.                                                                             |
| [background-client.ts](./background-client.ts)       | Adapt remote repository and command ports to the SDK's existing `SessionRuntime`; maintain synchronous handle snapshots and subscriptions. |
| [real-client.ts](./real-client.ts)                   | Own each surface's selection, drafts, submission journal and delivery recovery.                                                            |

Panels attach to the existing workspace connection instead of opening another metadata stream.
Closing a panel releases its session and machine handles without closing workspace synchronization.
Attachments, shortcuts and share packages retain their existing feature boundaries; files and upload callbacks do not cross this JSON port.
Each port must match the worker's verified account, token, workspace and origins before receiving data or submitting an operation.
Logout, identity changes and removal of a required host permission abort the old connection and invalidate its ports.
The SDK remains independent of extension APIs and preserves its request shapes and request IDs.

Chrome may stop an idle Manifest V3 worker.
A required `alarms` permission supports a one-minute synchronization wake, and browser startup restores an authorized workspace.
While a panel is attached, a periodic repository read checks its connection; a lost port fails outstanding requests and reconnects the view.
Neither reconnection nor an alarm replays a failed mutation.
The feature resolves uncertain delivery through its original submission journal.
No connection runs while Chrome is closed, and Chrome may defer alarms.
These lifecycle constraints follow [Chrome's service worker documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

The session storage record `lody:workspace:status` reports background connection state and failures without credentials or conversation content.
It is diagnostic state, not proof of a successful message delivery.
The [packaged connection journey](../../../tests/extension/background-connection.spec.ts) verifies preconnection without a panel, reuse across panels, remote updates with panels closed, actual worker termination and recovery, and logout isolation.
