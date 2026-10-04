# Browser task notifications

This adapter observes existing Lody Streams sessions through the independent SDK.
It needs no Desktop bridge and does not add a server endpoint.
The settings surface uses the [official Lody controls](../../shared/ui/README.md).

| Owner          | Contract                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `client.ts`    | Explicit permission request, settings subscription, foreground session presence and scoped click navigation.   |
| `lifecycle.ts` | MV3 listeners, one-minute alarms, account fencing, durable event identities and browser notification delivery. |
| `observe.ts`   | SDK metadata sync and terminal/permission verification from the matching session document.                     |
| `model.ts`     | Local notification journal; no prompt, response or generated conversation title in system notifications.       |

Enabling requests optional `notifications` and `alarms` permissions.
Denial leaves the existing sidebar status available.
Chrome does not expose those APIs before permission is granted, so listeners register both at worker startup and after grants.
Revocation aborts an active read, disables polling and clears its alarm.
Changing the stored account, token or workspace clears the old journal and requires explicit re-enabling.
Existing foreground ports are bound to their initial account generation and disconnected on account change; a late focus message cannot reassign an old session to the new account.
No old credential is retained in the journal.

Opening a conversation tracks its ID, up to the 20 most recently viewed conversations.
An alarm opens a bounded SDK connection for at most 20 seconds, synchronizes metadata in an independent account-scoped IndexedDB repository, and closes the connection.
At most five changed session documents are read per wake; deferred observations retain their prior checkpoint.
Failed reads remain visible in settings and back off exponentially to 15 minutes.
The observer never sends a runtime command.

The first metadata observation establishes a baseline without notifying about history.
A locally confirmed send/start records its exact user turn ID separately: the worker verifies the UI account identity through the SDK before storing it, and can notify about that turn even if it finishes before its first periodic observation.
A notification-registration failure does not change the confirmed message delivery result.
An idle transition or changed message timestamp only triggers document verification: the latest assistant after the expected user turn must be finished or failed.
Missing or mismatched terminal data stays pending for another wake.
Permission notifications use actual unresolved request IDs.
Stored event IDs prevent replay after worker restarts; foreground presence suppresses a popup for the conversation currently being read.
The event is persisted before calling the browser notification API, preferring a missed popup during an abrupt worker termination over repeated notifications.
A notification click creates a random navigation nonce tied to the newly opened Chrome tab ID.
The background worker serially validates and consumes that short-lived, account-scoped intent.
Independent clicks cannot overwrite each other or be consumed by another tab.

This is bounded polling, not remote push.
Typical latency is about one minute and Chrome may defer alarms.
Closing the sidebar does not stop it; closing Chrome does.
A running remote task continues independently.
A short operation entirely between polls is still discoverable through changed metadata, but an event that never updates authoritative metadata cannot be inferred.
Native notification presentation also depends on the operating system's notification settings.

## MV3 WASM bootstrap

Loro's bundler entry and Flock's convenience wrapper initialize WASM with top-level await.
That cannot run in WXT's classic service worker. [Worker build integration](../../../tools/vite/worker-wasm.ts) selects Loro's explicit web initializer and defers Flock initialization until a read lease starts.
Both WASM binaries remain packaged assets under the existing CSP.
Lifecycle listeners register synchronously before any WASM initialization.
The transformation fails visibly if Flock's upstream initialization contract changes; there is no remote script or CSP relaxation.

## Evidence

The [packaged observer journey](../../../tests/extension/notifications.spec.ts) uses the compiled extension, real Chrome alarms/permissions/storage, and SDK HTTP/Streams against controlled external boundaries.
It covers consent, a quiet historical baseline, closing the panel, refusing an unfinished assistant, forced service-worker termination followed by an actual alarm restart, verified completion registered in Chrome notifications, repeated-poll deduplication, first-interval task completion, independently addressed navigation, permission revocation and rejection of stale foreground ports/submission callbacks in one attempt.
Navigation records are seeded as an explicit native-click boundary; OS popup clicks themselves are not automated.
Its trace records the temporary-install permission baseline; OS permission prompt acceptance is not automated.
Accelerated alarms exercise the actual registered browser event, rather than calling an internal polling function.

The notification icon is copied from `vendor/lody/site-docs/public/_docs-assets/logo-96.png`.
