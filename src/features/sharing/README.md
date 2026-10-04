# Session sharing

The extension follows Lody's [session share manager](../../../vendor/lody/packages/components/src/components/sharing/session-share-manager.tsx) and [publisher hook](../../../vendor/lody/packages/components/src/hooks/use-session-share-management.ts): select content, inspect a fixed preview, explicitly publish, then manage the resulting link.
`ShareDialog` uses the shared Lody dialog and controls, official `shareSurface` styles, and the conversation renderer.

| Owner              | Contract                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SharePreview.tsx` | Decode the prepared package with the SDK, verify history hashes, render the sanitized history and expose its full public data for inspection.                                                                      |
| `journal.ts`       | Store detached bytes, manifest, request identity, separate upload and reader credentials, deployment receipt and confirmation state in IndexedDB under the account/deployment/workspace identity and root session. |
| `publisher.ts`     | Serialize operations across windows with Web Locks, persist before mutation, reuse immutable requests after uncertain delivery, and query authoritative publication or revocation state before reporting success.  |
| SDK sharing facade | Own authenticated management requests, secret-only data-plane requests, sanitization, attachment policy, content hashes and protocol validation.                                                                   |

Closing or reloading the dialog never discards an uncertain publication.
An unsubmitted preview can be discarded; once publication starts, the dialog offers recovery or an explicit cloud revocation.
Reader credentials are saved before publication and never written into synchronized workspace documents.
A reset saves its proposed secret before requesting the mutation and proves that secret against the public reader before accepting a changed credential version.
Another actor's credential change cannot be mistaken for this device's reset.

The public reader and data API origins are explicit deployment configuration.
Missing configuration disables publication, while authenticated management and revocation remain available.
The current upstream policy excludes file attachments from shares; included images have verified bytes and safe raster previews.
Sanitization removes protocol-owned credentials and capability fragments; arbitrary prose and tool output still require the publisher's review.

Browser infrastructure tests exercise real IndexedDB and Web Locks across uncertain upload, uncertain publication, deployment changes and revocation.
Storybook provides narrow-screen preview and missing-configuration states without publishing to a real service.
