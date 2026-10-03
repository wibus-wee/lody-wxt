# Lody connection boundary

[client.ts](./client.ts) owns `LodyClient`, session / message / execution-target types and explicit capabilities.
UI calls this interface, never loose fetches or desktop / daemon modules. [demo-client.ts](./demo-client.ts) transports commands to the MV3 worker (or one local preview runtime); [demo-directory.ts](./demo-directory.ts) contains a clearly synthetic workspace / machine / Agent / repository catalog.

Real mode currently fails closed.
Workspace ID is configuration, not authentication.
There is no usable extension login or pairing configuration in this repository; the active coding-agent MCP connection is not an extension account token.
No credential is read, copied or embedded.
There is no invented REST route, event format or fallback to mock data.

## Inspected upstream contracts

| Source                                                                                                                                                                                                              | Actual contract                                                                                         | Why it cannot simply be imported / reused here                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [workspace streams transport](../../../vendor/lody/packages/components/src/providers/workspace-streams-transport.ts)                                                                                                | Authenticated Loro Streams, workspace repository documents and subscriptions                            | Requires browser-safe authentication, document mapping and transport ownership; not a generic chat SSE endpoint                                 |
| [MCP protocol](../../../vendor/lody/apps/cli/src/mcp/lody-mcp-http-protocol.ts), [host](../../../vendor/lody/apps/cli/src/mcp/lody-mcp-http-host.ts), [MCP README](../../../vendor/lody/apps/cli/src/mcp/README.md) | Loopback `/mcp`, bearer secret, session/workspace/machine/workdir headers and active-turn authorization | Agent execution transport, not Chrome account login. Secret originates in a supervisor-owned process environment; extension must not capture it |
| [shared contracts](../../../vendor/lody/packages/shared/AGENTS.md)                                                                                                                                                  | Workspace, machine, session, Agent configuration and project semantics                                  | Keep these identities; do not substitute an unrelated model picker                                                                              |

The available Lody MCP creation-options capability was inspected read-only to confirm execution-target semantics.
No session was created in the user's real account.
The extension does not call that coding-agent connection.

## Remaining real integration

1. Provide a documented Chrome-safe login or explicit user pairing flow, scoped token lifetime / revocation, allowed origins and extension CSP requirements.
   Neither a packaged key nor credentials from another app are acceptable.
2. Adapt the authenticated workspace / machine / Agent configuration and project directory into the selection flow.
   GitHub matching must use a repository already configured on the selected machine, never an assumed path.
   The current demo directory must not leak into real mode.
3. Map upstream session creation, user turns, durable history and streamed document updates into `LodyClient`, including remote idempotency, reconnect cursors and account-scoped query/storage keys.
   Preserve untrusted page-context metadata through the actual prompt/document contract.
4. Advertise cancellation only when the backend supports the real operation.
   Expose approval requests only through an authenticated capability and explicit user action.
   Current capabilities deliberately prohibit approval and autonomous page actions.
5. Add real-server contract / reconnect / auth-expiry tests and permission/CSP packaged journeys before enabling sending in real mode.

This is an integration checklist, not a claim that upstream lacks all of these backend capabilities.
They have not been exposed as an authenticated browser contract for this extension.
Real mode cannot be used until that boundary is supplied and verified.
