# Session creation protocol parity

This comparison follows Lody revision `e73d3109b26412186d67571992a3ba1363433645`.
The browser extension uses the synchronized-document path, not the SDK's optional HTTP receipt gateway.
It does not require a Lody Desktop bridge; the selected machine still runs the agent.

## Authoritative path

The official [session submission](../../vendor/lody/packages/components/src/lib/session-submission.ts) builds metadata and accepts the first user turn.
[Send delivery](../../vendor/lody/packages/components/src/lib/session-send-delivery.ts) writes creation metadata, appends history and publishes `latestUserMsgId`.
Its `session/dispatch-turn` RPC is a best-effort acceleration; the persisted turn and activation pointer remain authoritative.
The [shared input builders](../../vendor/lody/packages/shared/src/session-input.ts) define the history envelope and turn configuration.

The extension follows [RealLodyClient](../../src/features/connection/real-client.ts) → [admission flows](../../src/features/conversations/session-flows.ts) → [SessionRuntime](./src/sessions/application/session-runtime.ts) → [LoroSessionRepository](./src/sessions/infrastructure/loro-session-repository.ts).
Admission journals belong to the extension and preserve the frozen metadata, prompt, configuration, timestamp and request ID.

## Field comparison

| Contract              | Mismatch found                                                                                                     | Current owner and behavior                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent routing         | Metadata omitted `cliType` and `agentType`; they existed only in the first turn.                                   | SDK [metadata builder](./src/sessions/domain/metadata.ts) writes both alongside `agentConfigId`, machine and user identity.                                                                                                       |
| Creation state        | Initial `status` and `historyBackend` were absent.                                                                 | New metadata contains `{type: 'idle'}` and `historyBackend: 'loro'`. Legacy metadata remains readable.                                                                                                                            |
| First activity        | `lastMessageAt` was missing. Official tab closing can treat such a session as empty.                               | First-turn admission supplies its frozen timestamp in epoch milliseconds before metadata publication. Repository activation also fills a missing first-turn activity field.                                                       |
| Draft title           | The extension displayed a local fallback without publishing the official draft title.                              | The feature follows upstream `deriveDraftSessionTitle` and `titleSource: 'draft'`. Generated titles can replace it.                                                                                                               |
| Project projection    | Only `project` was written.                                                                                        | The builder derives `repoFullName`, GitHub `baseBranch` and `isWorktree`. Opaque local branch selectors stay in `project.branch`, not `baseBranch`.                                                                               |
| Agent instructions    | The configured Agent prompt was omitted.                                                                           | The first request prefixes it to `inputConfig.prompt`, as the official landing page does. History `items` and `inputBlocks` retain the user's content, so instructions do not become user-authored chat text.                     |
| Model and mode        | Defaults used the first legacy model and ad hoc mode IDs.                                                          | The feature [configuration adapter](../../src/features/connection/run-configuration.ts) follows category-based catalogs, current model values and the official builtin permission default. Explicit user choices take precedence. |
| Generic agents        | Configurations without a legacy model list were rejected.                                                          | Registry/custom agents use `configOptionValues`; absent dedicated model/mode fields are omitted. Nonempty option tables take precedence over legacy arrays.                                                                       |
| Empty configuration   | Empty `configOptionValues` objects were always emitted.                                                            | Empty maps are omitted, matching the official input builder.                                                                                                                                                                      |
| Default MCP selection | Defaults were applied only after opening the picker.                                                               | A fresh start freezes default-enabled catalog IDs when no explicit selection exists. An explicit empty list remains empty. Catalog errors remain errors.                                                                          |
| User history envelope | `read: false` was absent.                                                                                          | Repository-written user turns include it, together with `pending`, `finished: true`, `items`, `inputConfig` and `fileDiff`.                                                                                                       |
| Recovery              | Creation journals stripped added metadata fields; retry could move the activation pointer back to an earlier turn. | Journals retain typed creation fields. Repository creation fills missing fields without replacing later edits; activation respects a newer turn's pointer.                                                                        |

MCP selection persists across replies and reopening: explicit composer selection takes precedence, then the final queued turn, then the latest user turn.
An existing conversation without an MCP field resolves to an empty selection; only a new draft applies catalog defaults.

The Agent prompt is launch input, not another message.
Web references remain part of the same user prompt/text block; files and images remain reference blocks with their original storage identities.
The daemon resolves executable configuration, environment and authentication from `agentConfigId`; those secrets do not belong in the browser's turn payload.

## Deliberate limits

- The SDK confirms persistence/synchronization before reporting `synced`; official UI admission can return after its local write.
  This timing differs.
  Neither response proves that the agent ran successfully.
- The extension currently uses durable activation rather than the optional `session/dispatch-turn` acceleration.
  No synthetic acceptance is returned when the machine is unreachable.
- Per-Agent desktop UI preferences and Role selection are not synchronized by this extension.
  Role provenance, Role prompt prefixes and desktop draft state are not fabricated.
- Runtime override authority and all ACP configuration shapes are not fully reproduced by the extension's selector.
  The supported catalog boundary remains visible; an unavailable value must fail validation.
- The SDK's HTTP `session-submissions` gateway is a separately configured receipt-service contract.
  That route is not present in the referenced official tree and is not used by the extension.
  Its tests do not establish official server support.

## Verification

[SDK protocol tests](./test/upstream-protocol.test.mjs) and metadata tests cover persisted envelopes, creation projection and retry behavior.
The feature's non-component [real-client tests](../../tests/browser/real-client.browser.test.ts) cover actual adapter output and immutable recovery; [configuration tests](../../tests/browser/run-configuration.browser.test.ts) cover builtin and generic capability catalogs.
Rendered journeys use the production adapter and real Loro/Flock transport boundaries.
Test fixtures must publish complete configuration tables when `configOptions` is present; a contradictory legacy model array must not mask a missing category.

These are controlled protocol and rendered integration checks.
They do not claim that every installed native agent, custom runtime override or private deployment has been exercised live.
