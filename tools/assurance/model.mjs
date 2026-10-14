// Product obligations are authored from the owners below. Test discovery never adds obligations.
export const model = {
  version: 1,
  derivation:
    'Product entrypoints, scoped state stores, generation fences and SDK lifecycle ports.',
  owners: {
    distribution: {
      source: [
        'tools/release/artifacts.mjs',
        '.github/workflows/release.yml',
        'src/features/updates/config.json',
      ],
      state: 'Verified release artifacts and appcast metadata derived from the same ZIP.',
      persistence: 'Version-tagged GitHub Release with immutable ZIP URL, length and SHA-256.',
      lifetime:
        'The update source becomes visible only with a verified published release; failed builds publish no feed.',
    },
    updates: {
      source: [
        'src/features/updates/appcast.ts',
        'src/features/updates/lifecycle.ts',
        'src/features/updates/use-updates.ts',
        'src/features/updates/UpdateNotice.tsx',
        'src/features/updates/UpdateSettingsLink.tsx',
        'src/features/updates/archive.ts',
        'src/features/updates/directory-binding.ts',
        'src/features/updates/directory-transaction.ts',
        'src/features/updates/directory-update.ts',
        'src/features/updates/DirectoryUpdate.tsx',
        'src/features/updates/DirectoryUpdateView.tsx',
        'tools/release/artifacts.mjs',
      ],
      state:
        'Installed version, validated stable appcast, last successful check, failures and skipped version.',
      persistence:
        'Extension local storage across surfaces and worker restarts; version-pinned release assets.',
      lifetime:
        'Six-hour checks omit credentials; failed or invalid feeds retain confirmed metadata and expose failure. Downloads and native directory grants require a user action. Manifest-last writes retain a rollback journal; lost grants retain recovery controls until the original directory is reauthorized. Browser reload remains explicit.',
    },
    notifications: {
      source: [
        'src/features/notifications/lifecycle.ts',
        'src/features/notifications/observe.ts',
        'src/features/notifications/client.ts',
      ],
      state:
        'Explicit notification consent, scoped metadata observations, terminal event identities and foreground presence.',
      persistence:
        'Trusted account-scoped local journal plus browser alarms; no prompt or response in system notification.',
      lifetime:
        'Worker wakes for bounded SDK reads; closed panels do not stop observation; permission/account changes abort old reads and isolate navigation.',
    },
    sharing: {
      source: [
        'src/features/sharing/ShareDialog.tsx',
        'src/features/sharing/journal.ts',
        'packages/lody-sdk/src/sharing/infrastructure/share-client.ts',
      ],
      state:
        'Frozen sanitized share package, explicit disclosure, separate upload/reader credentials and authoritative deployment/revocation status.',
      persistence:
        'Scoped IndexedDB package and immutable mutation IDs before network effects; service management authority for publication.',
      lifetime:
        'Prepare does not publish; confirmation releases upload; uncertain publication reuses frozen bytes and IDs; revoke queries authority.',
    },
    privacy: {
      source: [
        'src/features/privacy/memory.ts',
        'src/features/privacy/browser-permissions.ts',
        'src/features/privacy/BrowserPrivacySettings.tsx',
      ],
      state: 'Explicit personal preferences and separately granted browser API/site access.',
      persistence:
        'Account/origin/workspace scoped local preference text with revision guard; browser permission store is authoritative.',
      lifetime:
        'Disabled preferences do not enter new prompts; local attachment clearing retains a revision tombstone and aborts stale owners.',
    },
    dictation: {
      source: ['src/features/voice/recognition.ts', 'src/features/voice/DictationDialog.tsx'],
      state:
        'Browser recognition availability, microphone request, final/interim text and explicit insertion.',
      persistence:
        'No audio or interim transcript is stored; confirmed text enters the existing draft.',
      lifetime:
        'Only Start activates recognition; close/unmount aborts and fences late callbacks; service failure preserves prior draft.',
    },
    account: {
      source: ['src/features/account/controller.ts', 'src/features/account/storage.ts'],
      state: 'Device authorization, token deadline, validated identity and selected workspace.',
      persistence:
        'Trusted extension storage.local; web localStorage. Legacy session storage is migrated.',
      lifetime: 'A generation ends on cancel, logout, expiry, restore or storage identity changes.',
    },
    connection: {
      source: [
        'src/features/connection/use-client.ts',
        'src/features/connection/real-client.ts',
        'src/features/connection/background-lifecycle.ts',
      ],
      state:
        'Streams grant, visible machines, capabilities, target, session handles and subscriptions.',
      persistence:
        'Target preference, Loro IndexedDB and remote cursors scoped by origin/account/workspace.',
      lifetime:
        'The extension worker validates stored identity and owns the shared workspace runtime before any panel opens; panel leases reuse it; worker restart revalidates; account/session/token/workspace changes close the old runtime.',
    },
    quickDraft: {
      source: ['src/features/chat/ConnectedChat.tsx'],
      state: 'Text, attached page contexts, selected conversation and per-turn run configuration.',
      persistence: 'localStorage draft scoped by client.accountKey and conversation or new.',
      lifetime:
        'The selected conversation is retained in origin/account/workspace-scoped localStorage for five minutes after panel close; explicit new conversation clears the selection; drafts remain scoped to that conversation or a new chat across reload; confirmed send clears the submitted draft.',
    },
    chatScroll: {
      source: ['src/features/chat/Chat.tsx', 'src/features/chat/use-transcript-scroll.ts'],
      state:
        'Reader follow intent, visible transcript geometry and conversation-scoped reading position.',
      persistence: 'Optional sessionStorage position scoped to account and conversation.',
      lifetime:
        'User upward navigation releases follow; output and layout changes preserve that intent; reload restores a reading position after transcript hydration.',
    },
    attachmentDrafts: {
      source: [
        'src/features/chat/attachment-drafts.ts',
        'src/features/chat/use-attachment-drafts.ts',
        'src/features/chat/ConnectedChat.tsx',
      ],
      state:
        'Scoped binary draft, reserved session/request identity, per-file upload receipt and progress.',
      persistence:
        'IndexedDB Blob records with transactional revision checks; confirmed remote references retained until confirmed send.',
      lifetime:
        'Selecting files creates no cloud session; upload happens on send; scope changes abort local waiting; only confirmed delivery clears matching binaries.',
    },
    automations: {
      source: [
        'src/features/automations/AutomationsPanel.tsx',
        'src/features/automations/journal.ts',
        'packages/lody-sdk/src/schedules/infrastructure/schedule-repository.ts',
      ],
      state:
        'Authoritative Prompt Shortcut directory, resource-scoped Flock catalogs, immutable Loro bodies, legacy local drafts and durable schedule mutations.',
      persistence:
        'Private/shared shortcut Streams use exact-resource grants; local legacy drafts remain local until explicit migration; schedules publish a Loro document then Flock registry.',
      lifetime:
        'Shortcut use fills an editable draft without sending; body revisions must match the authorized index; schedules await sync and observe the machine ledger.',
    },
    quickDelivery: {
      source: [
        'src/features/connection/real-client.ts',
        'src/features/conversations/session-flows.ts',
      ],
      state:
        'Creation reservation, first-turn admission and delivery journal with immutable request identity.',
      persistence: 'Three scoped localStorage records protected by a Web Lock.',
      lifetime:
        'Persist before remote effects; ambiguous delivery survives reload; confirmation checks metadata and turn.',
    },
    advanced: {
      source: [
        'src/features/conversations/WorkspacePage.tsx',
        'src/features/conversations/runtime-controller.ts',
        'src/features/conversations/admission.ts',
        'src/features/conversations/turn-journal.ts',
      ],
      state: 'Session list/history, creation draft, reply draft and dispatch/queue/guide journals.',
      persistence:
        'Independent scoped localStorage journals and IndexedDB repository; not the quick-chat journal.',
      lifetime:
        'Route unmount disconnects handles; identity fences suppress late completion; command failure stays visible.',
    },
    documents: {
      source: [
        'packages/lody-sdk/src/sessions/infrastructure/loro-session-repository.ts',
        'packages/lody-sdk/src/documents/infrastructure/birpc-document-session.ts',
      ],
      state: 'Session metadata, history, permission outcomes and remote sync cursors.',
      persistence: 'Remote Streams/Loro plus scoped local repository and cursors.',
      lifetime:
        'Append/flush and metadata publication are separate confirmation links; subscribe errors remain visible.',
    },
    machine: {
      source: [
        'packages/lody-sdk/src/sessions/application/session-runtime.ts',
        'packages/lody-sdk/src/sessions/infrastructure/machine-flock.ts',
      ],
      state:
        'Agent capabilities and remote execution, stop, steer, fork, edit and deletion requests.',
      persistence: 'Remote machine; a local promise or command receipt is not completed execution.',
      lifetime:
        'Commands name exact session/turn/request; abort ends local waiting, not necessarily remote work.',
    },
    capture: {
      source: [
        'src/features/page-context/capture.ts',
        'src/features/page-context/model.ts',
        'src/features/page-context/screenshot-selection.ts',
        'src/features/page-context/screenshot-overlay.tsx',
      ],
      state: 'Active tab grant, selection, extracted untrusted text and frozen viewport pixels.',
      persistence:
        'Explicitly captured context enters a scoped draft; URL secrets and sensitive DOM are excluded.',
      lifetime:
        'Only a user capture action crosses tab-to-extension boundary; denial preserves draft. Screenshot overlays disconnect on navigation or draft change; cancellation restores page focus without attachment.',
    },
    transport: {
      source: [
        'src/features/network/background.ts',
        'src/features/network/transport.ts',
        'src/features/network/protocol.ts',
      ],
      state:
        'Trusted sender, allowlisted origin/method, deadline, request ID and abort controller.',
      persistence: 'Worker request map is ephemeral; credentials are explicit and cookies omitted.',
      lifetime: 'Worker restart loses in-flight requests; cancellation is sender/request scoped.',
    },
    appearance: {
      source: [
        'src/features/preferences/use-preferences.ts',
        'src/shared/storage.ts',
        'src/app/App.tsx',
        'src/features/ambient/Ambient.tsx',
      ],
      state:
        'Persisted preferences, Jotai mood, React Query cache, system theme and Reduce Motion.',
      persistence:
        'Extension storage.local or web localStorage; cross-surface change subscriptions.',
      lifetime:
        'Save publishes after durable write; system motion policy also governs shader mounting.',
    },
    shell: {
      source: [
        'src/app/App.tsx',
        'src/features/page-context/lifecycle.ts',
        'src/features/introduction/Introduction.tsx',
        'src/features/introduction/sequence.ts',
        'wxt.config.ts',
      ],
      state:
        'Popup/options/sidepanel/web surfaces, hash route and extension lifecycle registration.',
      persistence: 'Manifest and browser-installed side panel behavior.',
      lifetime:
        'Popup delegates to the sidepanel; web and sidepanel retain mounted chat while account, settings or introduction is open; options hosts settings; conversation-management routes are unmounted.',
    },
  },
  namespaces: {
    updates: {
      disposition: 'journey',
      owners: ['distribution', 'updates', 'account', 'quickDraft', 'documents', 'shell'],
      reason:
        'Release metadata, browser lifecycle, cross-surface reminders and manual downloads must preserve their version and failure boundaries.',
    },
    notifications: {
      disposition: 'journey',
      owners: ['notifications', 'account', 'connection', 'shell'],
      reason:
        'Closed-panel observation, terminal validation, deduplication and account isolation cross worker and browser permission lifetimes.',
    },
    sharing: {
      disposition: 'unmounted-adapter',
      owners: ['sharing', 'connection', 'documents'],
      reason:
        'ShareDialog and its publication adapters have no reachable mounted disclosure action; protocol checks do not establish a product sharing journey.',
    },
    privacy: {
      disposition: 'journey',
      owners: ['privacy', 'quickDraft', 'attachmentDrafts', 'account'],
      reason:
        'Preference consent, scope isolation and local file deletion cross durable account boundaries.',
    },
    dictation: {
      disposition: 'journey',
      owners: ['dictation', 'quickDraft', 'shell'],
      reason:
        'Microphone activation and transcript insertion require independent explicit actions and cancellation.',
    },
    identity: {
      disposition: 'journey',
      owners: ['account', 'connection'],
      reason: 'Authorization and identity fences control access to every conversation.',
    },
    quickChat: {
      disposition: 'journey',
      owners: ['quickDraft', 'quickDelivery', 'connection', 'documents', 'chatScroll'],
      reason: 'Primary user conversation surface and its independent delivery lifecycle.',
    },
    workspace: {
      disposition: 'journey',
      owners: ['account', 'quickDraft', 'capture', 'documents', 'machine'],
      reason: 'Mounted compact conversation actions edit, regenerate and fork retained history.',
    },
    pageContext: {
      disposition: 'journey',
      owners: ['capture', 'quickDraft', 'transport'],
      reason: 'Explicit tab capture crosses a privacy and permission boundary.',
    },
    appearance: {
      disposition: 'journey',
      owners: ['appearance', 'shell'],
      reason: 'Preferences must survive surface changes without disrupting work.',
    },
    extension: {
      disposition: 'journey',
      owners: ['shell', 'transport', 'account'],
      reason: 'Packaged lifecycle, worker transport and trusted-storage boundaries.',
    },
    sdk: {
      disposition: 'supporting-contract',
      owners: ['documents', 'machine'],
      reason:
        'SDK port/protocol verification supports journeys but cannot establish user outcomes.',
    },
    rendering: {
      disposition: 'supporting-contract',
      owners: ['shell'],
      reason:
        'Storybook and axe verify rendering/accessibility; visibility alone is not a journey.',
    },
    guidance: {
      disposition: 'supporting-contract',
      owners: ['shell'],
      reason:
        'Introduction is a host-controlled transient stepper; popup delegates to sidepanel/options. Rendered guidance supports entry into journeys without a separate durable workflow.',
    },
    offlineBridge: {
      disposition: 'unmounted-adapter',
      owners: ['documents'],
      reason:
        'The independent SDK offline document bridge has no mounted product journey; bridge protocol checks cannot certify chat recovery.',
    },
    attachments: {
      disposition: 'journey',
      owners: ['attachmentDrafts', 'quickDelivery', 'documents'],
      reason:
        'Quick composer explicitly configures attachment service and submits files with one user turn.',
    },
    automations: {
      disposition: 'journey',
      owners: ['automations', 'connection', 'quickDraft'],
      reason:
        'Saved workflows and cloud schedules must retain their own identity across reload and failure.',
    },
    httpSubmission: {
      disposition: 'unmounted-adapter',
      owners: ['advanced'],
      reason:
        'ConversationsController HTTP receipt adapter is not mounted by App routes; its tests do not prove the Loro user path.',
    },
  },
  journeys: [
    {
      id: 'install-directory-update',
      namespace: 'updates',
      priority: 'P0',
      intent:
        'Bind the actual unpacked installation, recover failed incremental updates and retain authenticated conversation drafts through native reload and grant loss.',
      chain: ['distribution', 'updates', 'account', 'quickDraft', 'documents', 'shell'],
      cases: [
        {
          id: 'native-recovery',
          requiredLayer: 'extension',
          lifecycle: [
            'sign-in',
            'draft',
            'bind',
            'reject',
            'download-failure',
            'write',
            'rollback',
            'reload',
            'reauthorize',
            'resume',
          ],
          states: [
            'updates:bound',
            'updates:recoverable',
            'updates:verified',
            'account:retained',
            'quickDraft:retained',
          ],
          obligations: [
            'authenticated-session-and-unsent-draft-established',
            'reject-copy-with-matching-manifest',
            'native-binding-persists-across-page-reload',
            'corrupt-index-rejected-before-write',
            'download-failure-preserves-installation',
            'only-changed-manifest-downloaded-and-written',
            'visible-rollback-restores-original-version',
            'reload-permission-loss-preserves-binding-and-recovery-controls',
            'pending-journal-rejects-different-directory',
            'real-reload-confirms-version-and-clears-completed-journal',
            'account-and-workspace-retained-after-update',
            'same-session-and-unsent-draft-retained-without-submission',
          ],
        },
      ],
    },
    {
      id: 'discover-and-download-update',
      namespace: 'updates',
      priority: 'P1',
      intent:
        'Discover a stable release, skip and restore reminders, retain confirmed metadata on failure and continue after a newer release and profile restart.',
      chain: ['distribution', 'updates', 'shell'],
      cases: [
        {
          id: 'packaged-appcast',
          interactions: ['update-check'],
          lifecycle: [
            'check',
            'discover',
            'skip',
            'reload',
            'manual-check',
            'failure',
            'newer-release',
            'profile-restart',
          ],
          states: [
            'updates:validated',
            'updates:skipped',
            'updates:error-visible',
            'updates:retained',
          ],
          obligations: [
            'trusted-feed-versioned-links',
            'quiet-reminder-preserves-chat-layout',
            'skip-persists-across-surfaces-and-reload',
            'manual-check-restores-reminders',
            'failed-check-retains-confirmed-release',
            'invalid-feed-cannot-change-download',
            'newer-release-resumes-reminders',
            'profile-restart-retains-update-state',
          ],
        },
      ],
    },
    {
      id: 'observe-background-session',
      namespace: 'notifications',
      priority: 'P1',
      intent:
        'Explicitly enable bounded background SDK observation, notify verified events once after closing the panel and stop at permission/account boundaries.',
      chain: ['account', 'notifications', 'connection', 'shell'],
      cases: [
        {
          id: 'packaged-background-observer',
          lifecycle: [
            'enable',
            'baseline',
            'close-panel',
            'wake',
            'notify',
            'deduplicate',
            'revoke',
            'switch-account',
          ],
          states: [
            'notifications:enabled',
            'notifications:baseline',
            'notifications:verified-event',
            'notifications:isolated',
          ],
          obligations: [
            'consent-and-baseline',
            'closed-panel-terminal-verified',
            'same-event-not-repeated',
            'first-poll-fast-task-verified',
            'navigation-bound-to-tab',
            'stale-foreground-cannot-cross-scope',
            'permission-and-account-isolation',
          ],
        },
      ],
    },
    {
      id: 'personal-preferences',
      namespace: 'privacy',
      priority: 'P1',
      intent:
        'Enable explicit personal preferences, send their visible frozen content, then disable and delete them without losing a draft.',
      chain: ['privacy', 'quickDraft', 'connection', 'documents'],
      cases: [
        {
          id: 'consent-and-removal',
          lifecycle: ['author', 'enable', 'reload', 'send', 'disable', 'delete'],
          states: [
            'privacy:explicitly-enabled',
            'documents:preference-in-one-prompt',
            'quickDraft:retained',
          ],
          obligations: [
            'preference-off-by-default',
            'enabled-preference-visible-after-reload',
            'preference-in-single-submission',
            'disabled-preference-excluded',
            'deletion-preserves-draft',
          ],
        },
      ],
    },
    {
      id: 'dictate-and-review',
      namespace: 'dictation',
      priority: 'P1',
      intent:
        'Handle recognition refusal, retry, review final text and explicitly insert it without submitting the conversation.',
      chain: ['dictation', 'quickDraft', 'shell'],
      cases: [
        {
          id: 'service-boundary',
          lifecycle: ['open', 'start', 'denied', 'retry', 'review', 'insert'],
          states: ['dictation:denial-visible', 'dictation:reviewed', 'quickDraft:not-sent'],
          obligations: [
            'opening-does-not-start-microphone',
            'microphone-denial-preserves-draft',
            'recognition-denial-preserves-draft',
            'final-text-editable-before-insert',
            'insertion-does-not-send',
          ],
        },
      ],
    },
    {
      id: 'workflow-lifecycle',
      namespace: 'automations',
      priority: 'P1',
      intent:
        'Read existing Lody Prompt Shortcuts through resource-scoped authorization, publish coherent revisions across reloads and explicitly migrate legacy local drafts without sending.',
      chain: ['automations', 'connection', 'quickDraft'],
      cases: [
        {
          id: 'synced-shortcut',
          lifecycle: ['desktop-source', 'authorize', 'edit', 'reload', 'use', 'share', 'delete'],
          states: [
            'automations:resource-authorized',
            'automations:revision-synced',
            'automations:shared-readonly',
            'quickDraft:filled-not-sent',
          ],
          obligations: [
            'desktop-private-and-shared-discovered',
            'resource-grants-reject-workspace-token',
            'shared-member-shortcut-readonly',
            'body-and-index-revision-survive-reload',
            'use-preserves-existing-draft-without-send',
            'sharing-rotates-body-with-cas',
            'deletion-revokes-and-isolates-private-content',
          ],
        },
        {
          id: 'legacy-migration',
          lifecycle: ['legacy-draft', 'preview', 'cancel', 'confirm', 'reload'],
          states: [
            'automations:legacy-local',
            'automations:migration-explicit',
            'automations:revision-synced',
          ],
          obligations: [
            'legacy-records-never-upload-on-open',
            'migration-preview-cancel-preserves-local',
            'confirmed-migration-publishes-private-once',
            'migration-reload-retains-cloud-and-draft',
          ],
        },
      ],
    },
    {
      id: 'synced-shortcuts',
      namespace: 'automations',
      priority: 'P0',
      intent:
        'Select official slash commands, synced Prompt Shortcuts, skills and authorized session mentions at the caret; retain ranges across reload and expand one confirmed turn.',
      chain: ['connection', 'automations', 'quickDraft', 'quickDelivery'],
      cases: [
        {
          id: 'packaged-shortcut-entrypoints',
          lifecycle: ['worker-connected', 'slash-open', 'manager-open', 'select', 'reload'],
          states: [
            'connection:workspace-bound',
            'automations:resource-authorized',
            'quickDraft:filled-not-sent',
            'quickDraft:restored',
          ],
          obligations: [
            'packaged-slash-discovers-authorized-shortcuts',
            'packaged-manager-discovers-authorized-shortcuts',
            'worker-preserves-resource-scoped-grant-envelope',
            'packaged-shortcut-insertion-retains-unsent-draft',
            'packaged-shortcut-draft-survives-reload',
            'packaged-warm-shortcut-entrypoints-reauthorize',
          ],
        },
        {
          id: 'composer-mentions',
          lifecycle: [
            'live-index',
            'slash-search',
            'keyboard-insert',
            'draft-reload',
            'session-mention',
            'skill-expand-send',
          ],
          states: [
            'automations:resource-authorized',
            'quickDraft:source-ranges',
            'quickDraft:filled-not-sent',
            'quickDelivery:single-prompt',
          ],
          obligations: [
            'merged-command-and-cloud-shortcut',
            'caret-replacement-no-auto-send',
            'escaped-or-ime-no-commit',
            'mention-ranges-survive-reload',
            'frozen-skills-expand-in-single-prompt',
            'session-mention-stable-id',
          ],
        },
        {
          id: 'upstream-navigation',
          lifecycle: [
            'categories',
            'keyboard-drilldown',
            'navigate-back',
            'touch-select',
            'canonical-command',
            'shortcut-prepare',
            'atomic-edit',
            'send',
          ],
          states: [
            'quickDraft:category-navigation',
            'quickDraft:source-ranges',
            'automations:scope-verified',
            'quickDelivery:single-prompt',
          ],
          obligations: [
            'bare-at-does-not-discover-sources',
            'directional-category-navigation-preserves-focus',
            'pointer-back-and-touch-leaf-selection',
            'canonical-command-triggers-and-modified-keys',
            'unavailable-shortcut-cannot-commit',
            'shortcut-inserts-structured-ranges-and-literal-parameters',
            'committed-range-caret-and-backspace-are-atomic',
            'shortcut-application-sends-one-expanded-prompt',
          ],
        },
      ],
    },
    {
      id: 'schedule-recovery',
      namespace: 'automations',
      priority: 'P0',
      intent:
        'Stage a schedule edit, retain its identity after lost publication, reconcile and observe authoritative runtime status.',
      chain: ['automations', 'connection', 'machine', 'documents'],
      cases: [
        {
          id: 'cloud-publication',
          lifecycle: ['stage', 'publish-failure', 'reload', 'same-id-recovery', 'runtime-observed'],
          states: ['automations:pending', 'documents:schedule-synced', 'machine:runtime-observed'],
          obligations: [
            'failed-publication-visible-and-retained',
            'same-schedule-and-mutation-after-reload',
            'registry-matches-durable-document',
            'runtime-status-not-inferred-from-save',
          ],
        },
      ],
    },
    {
      id: 'attach-reload-and-send',
      namespace: 'attachments',
      priority: 'P0',
      intent:
        'Choose a local file, reload the unsent draft, upload only on Send and submit it with the prompt in one turn.',
      chain: ['attachmentDrafts', 'quickDraft', 'connection', 'quickDelivery', 'documents'],
      cases: [
        {
          id: 'file-first-turn',
          lifecycle: ['attach', 'reload', 'upload', 'send', 'confirm'],
          states: ['attachmentDrafts:durable', 'quickDelivery:one-turn', 'documents:confirmed'],
          obligations: [
            'no-preemptive-upload-or-session',
            'binary-and-text-restored',
            'authenticated-upload-same-reservation',
            'single-turn-with-file-and-prompt',
            'confirmed-binary-cleared',
          ],
        },
        {
          id: 'failed-upload',
          lifecycle: ['attach', 'upload', 'failure', 'reload', 'retry', 'confirm'],
          states: ['attachmentDrafts:retained', 'quickDraft:retained', 'documents:confirmed'],
          obligations: [
            'upload-failure-visible',
            'no-empty-session-after-upload-failure',
            'retry-retains-source-and-identity',
            'single-confirmed-turn-after-retry',
          ],
        },
      ],
    },
    {
      id: 'authorize-and-resume',
      namespace: 'identity',
      priority: 'P0',
      intent: 'Authorize a device, select a workspace, work, reload and resume the same identity.',
      chain: ['shell', 'account', 'transport', 'connection', 'quickDraft'],
      cases: [
        {
          id: 'durable',
          lifecycle: ['authorize', 'persist', 'reload'],
          states: ['account:signed-in', 'connection:workspace-bound', 'quickDraft:restored'],
          obligations: ['workspace-selected', 'draft-restored', 'same-identity-revalidated'],
        },
        {
          id: 'restore-outage',
          lifecycle: ['reload', 'failure', 'recover'],
          states: [
            'account:validation-error',
            'account:credentials-retained',
            'connection:reconnected',
          ],
          obligations: [
            'restore-failure-visible',
            'retry-revalidates-without-device-login',
            'prior-draft-restored',
          ],
        },
      ],
    },
    {
      id: 'cancel-authorization',
      namespace: 'identity',
      priority: 'P0',
      intent:
        'Cancel device authorization, reject late success, then authorize a fresh generation.',
      chain: ['account', 'transport', 'shell', 'connection'],
      cases: [
        {
          id: 'late-token',
          lifecycle: ['authorize', 'cancel', 'late-completion', 'restart'],
          states: ['account:cancelled', 'account:new-generation'],
          obligations: ['cancel-visible', 'late-token-rejected', 'fresh-login-usable'],
        },
      ],
    },
    {
      id: 'send-and-continue',
      namespace: 'quickChat',
      priority: 'P0',
      intent:
        'Choose a real target/configuration, send a first turn, observe a response, visit settings and return to continue the same mounted conversation.',
      chain: [
        'account',
        'connection',
        'quickDraft',
        'chatScroll',
        'quickDelivery',
        'documents',
        'machine',
        'shell',
      ],
      cases: [
        {
          id: 'packaged-session-resume',
          lifecycle: ['send', 'close', 'reopen', 'expire', 'history', 'new'],
          states: ['quickDraft:session-scoped', 'documents:confirmed'],
          obligations: [
            'close-reopen-restores-same-session',
            'expiry-keeps-history-accessible',
            'history-opens-authoritative-conversation',
            'explicit-new-prevents-resume',
            'foreign-scope-does-not-restore',
          ],
        },
        {
          id: 'reader-scroll',
          lifecycle: ['inspect', 'stream', 'read-history', 'resize', 'jump', 'reload'],
          states: ['chatScroll:following', 'chatScroll:reading', 'documents:streaming-work'],
          obligations: [
            'short-inspection-does-not-offer-empty-jump',
            'small-upward-scroll-releases-follow-without-layout-shift',
            'stream-preserves-reading-position',
            'following-survives-composer-and-viewport-resize',
            'explicit-jump-resumes-follow',
            'reload-restores-reading-position-after-hydration',
          ],
        },
        {
          id: 'model-search',
          lifecycle: ['inspect', 'search', 'cancel', 'select', 'send'],
          states: [
            'connection:capabilities-ready',
            'quickDraft:session-scoped',
            'documents:confirmed',
          ],
          obligations: [
            'searchable-config-models',
            'empty-search-recovers',
            'selection-survives-reopen',
            'searched-model-reaches-turn',
          ],
        },
        {
          id: 'packaged-model-search',
          lifecycle: ['inspect', 'search', 'cancel', 'select', 'send'],
          states: [
            'connection:capabilities-ready',
            'quickDraft:session-scoped',
            'documents:confirmed',
          ],
          obligations: [
            'searchable-config-models',
            'empty-search-recovers',
            'selection-survives-reopen',
            'searched-model-reaches-turn',
          ],
        },
        {
          id: 'configured',
          interactions: ['send-feedback', 'first-response'],
          lifecycle: ['create', 'send', 'stream', 'route-hide', 'return', 'continue'],
          states: [
            'connection:capabilities-ready',
            'quickDraft:session-scoped',
            'documents:confirmed',
          ],
          obligations: [
            'configuration-reaches-turn',
            'first-response-visible',
            'route-preserves-session',
            'continuation-on-same-session',
          ],
        },
        {
          id: 'tools-and-queue',
          lifecycle: ['select-skill', 'select-connectors', 'send', 'stream', 'queue', 'reload'],
          states: [
            'quickDraft:explicit-tools',
            'documents:queued',
            'connection:capabilities-ready',
          ],
          obligations: [
            'skill-fills-draft-without-sending',
            'connector-selection-reaches-single-turn',
            'running-draft-enters-authoritative-queue',
            'reload-retains-queue-without-extra-turn',
          ],
        },
        {
          id: 'inspect-work',
          lifecycle: ['stream', 'inspect', 'complete', 'reload', 'continue'],
          states: ['documents:streaming-work', 'documents:finished-answer', 'quickDraft:retained'],
          obligations: [
            'commentary-tool-order',
            'details-inspectable',
            'final-answer-folds-on-completion',
            'reload-keeps-complete-answer',
          ],
        },
      ],
    },
    {
      id: 'recover-ambiguous-send',
      namespace: 'quickChat',
      priority: 'P0',
      intent:
        'Lose confirmation after a remote write, reload with preserved draft, reconcile exact request identity and continue once.',
      chain: ['quickDraft', 'quickDelivery', 'documents', 'connection', 'machine'],
      cases: [
        {
          id: 'first-turn',
          interactions: ['recovery-confirmed'],
          lifecycle: ['persist', 'partial-write', 'reload', 'reconcile', 'continue'],
          states: [
            'quickDelivery:unconfirmed',
            'quickDraft:retained',
            'documents:metadata-and-turn-confirmed',
          ],
          obligations: [
            'uncertainty-blocks-new-send',
            'journal-and-draft-survive-reload',
            'same-request-confirmed-once',
            'new-turn-after-recovery',
          ],
        },
        {
          id: 'cross-surface',
          lifecycle: ['claim', 'concurrent-send', 'reconcile'],
          states: ['quickDelivery:shared-lock', 'documents:single-admission'],
          obligations: [
            'one-surface-claims-delivery',
            'other-surface-blocked',
            'authoritative-refresh-without-duplicate-send',
          ],
        },
        {
          id: 'corrupt-record',
          lifecycle: ['persist', 'corrupt', 'reload', 'fail-closed'],
          states: ['quickDelivery:unreadable', 'quickDraft:retained'],
          obligations: ['corruption-visible', 'no-new-request', 'record-preserved'],
        },
      ],
    },
    {
      id: 'change-identity-during-work',
      namespace: 'identity',
      priority: 'P0',
      intent:
        'Change workspace or log out while old work is outstanding; keep old scoped state isolated and suppress late completion.',
      chain: ['account', 'connection', 'quickDraft', 'quickDelivery', 'documents', 'transport'],
      cases: [
        {
          id: 'workspace-switch',
          lifecycle: ['start', 'switch-scope', 'late-completion', 'return'],
          states: ['account:new-workspace', 'quickDraft:isolated', 'connection:old-closed'],
          obligations: [
            'old-content-not-in-new-workspace',
            'late-completion-not-published',
            'return-restores-old-draft',
          ],
        },
        {
          id: 'logout-other-surface',
          lifecycle: ['stream', 'cross-surface-logout', 'reload', 'relogin'],
          states: ['account:signed-out', 'connection:closed', 'quickDraft:scoped-retained'],
          obligations: [
            'all-surfaces-revoke-access',
            'late-stream-not-visible',
            'reload-stays-signed-out',
            'relogin-scopes-retained-draft',
          ],
        },
        {
          id: 'token-expiry',
          lifecycle: ['stream', 'expire', 'late-completion'],
          states: ['account:expired', 'connection:closed'],
          obligations: [
            'expiry-revokes-composer',
            'late-response-rejected',
            'fresh-login-required',
          ],
        },
      ],
    },
    {
      id: 'interrupt-and-resolve-permission',
      namespace: 'quickChat',
      priority: 'P0',
      intent:
        'Read streamed content, resolve a permission on the exact turn, stop execution and confirm a terminal state before continuing.',
      chain: ['quickDraft', 'documents', 'machine', 'connection'],
      cases: [
        {
          id: 'permission-stop',
          interactions: ['stop-observed'],
          lifecycle: ['stream', 'permission', 'stop-request', 'terminal-observed', 'continue'],
          states: [
            'machine:permission-pending',
            'documents:permission-resolved',
            'machine:stopped',
          ],
          obligations: [
            'permission-exact-turn',
            'partial-content-preserved',
            'stop-terminal-observed',
            'continuation-enabled-after-terminal',
          ],
        },
        {
          id: 'inspect-stopped-work',
          lifecycle: [
            'stream',
            'inspect',
            'stop-request',
            'terminal-observed',
            'reload',
            'continue',
          ],
          states: ['documents:partial-work-retained', 'machine:stopped', 'quickDraft:retained'],
          obligations: [
            'live-work-inspected',
            'terminal-keeps-partial-work',
            'reload-keeps-stopped-work',
            'continuation-from-stopped-work',
          ],
        },
        {
          id: 'stop-unconfirmed',
          lifecycle: ['stream', 'stop-request', 'failure', 'reread'],
          states: ['machine:stop-unconfirmed', 'documents:still-active'],
          obligations: [
            'stop-error-visible',
            'no-fabricated-terminal-state',
            'reread-reconciles-real-state',
          ],
        },
      ],
    },
    {
      id: 'capture-and-send-context',
      namespace: 'pageContext',
      priority: 'P0',
      intent:
        'Capture explicit page/selection text, preview and remove it, retain the edited draft across navigation and send only retained untrusted context.',
      chain: ['shell', 'capture', 'quickDraft', 'quickDelivery', 'documents', 'transport'],
      cases: [
        {
          id: 'packaged-source-picker',
          lifecycle: [
            'choose',
            'capture',
            'preview',
            'refresh',
            'retain',
            'inline-mention',
            'source-change',
            'reject-stale',
          ],
          states: [
            'capture:source-bound',
            'capture:partial-declared',
            'quickDraft:snapshot-retained',
          ],
          obligations: [
            'chosen-tab-is-exact-source',
            'denied-source-preserves-draft',
            'truncation-and-safe-locator-visible',
            'snapshot-immutable-until-explicit-refresh',
            'inline-tab-mention-preserves-draft-without-send',
            'stale-tab-mention-rejected',
          ],
        },
        {
          id: 'packaged-document-image',
          lifecycle: ['select', 'parse', 'preview', 'remove', 'recover'],
          states: ['capture:local-pdf-parsed', 'capture:visual-preview', 'quickDraft:retained'],
          obligations: [
            'packaged-pdf-worker-and-page-markers',
            'invalid-or-scanned-pdf-keeps-draft',
            'real-image-preview-and-removal',
            'changed-document-capture-refused',
          ],
        },
        {
          id: 'packaged-screenshot-overlay',
          lifecycle: ['grant', 'capture', 'select', 'attach', 'cancel', 'navigate'],
          states: ['capture:visual-preview', 'quickDraft:retained', 'capture:source-bound'],
          obligations: [
            'overlay-isolated-accessible-and-no-panel-dialog',
            'pointer-crop-matches-screenshot-pixels',
            'full-screenshot-excludes-overlay',
            'cancel-preserves-draft-and-page',
            'source-navigation-cleans-overlay',
          ],
        },
        {
          id: 'packaged-browser-library',
          lifecycle: ['grant', 'search', 'select', 'manage', 'revoke'],
          states: [
            'capture:library-authorized',
            'quickDraft:selected-link-only',
            'capture:permission-revoked',
          ],
          obligations: [
            'library-permission-explicit',
            'bounded-search-selected-link-only',
            'bookmark-mutations-observed',
            'revocation-prevents-next-query',
          ],
        },
        {
          id: 'packaged-selection',
          lifecycle: ['grant', 'capture', 'preview', 'remove', 'reload', 'send'],
          states: ['capture:untrusted', 'capture:sanitized', 'quickDraft:context-retained'],
          obligations: [
            'secret-content-excluded',
            'preview-and-removal-observed',
            'context-restored-after-reload',
            'only-retained-context-sent',
          ],
        },
        {
          id: 'permission-denied',
          lifecycle: ['draft', 'capture-denial', 'recover', 'send'],
          states: ['capture:denied', 'quickDraft:unchanged'],
          obligations: ['denial-visible', 'draft-unchanged', 'later-explicit-capture-works'],
        },
      ],
    },
    {
      id: 'edit-fork-and-delete',
      namespace: 'workspace',
      priority: 'P0',
      intent:
        'Edit an owned turn, regenerate it and fork a completed response while preserving source history and attached context across reload.',
      chain: ['account', 'quickDraft', 'capture', 'documents', 'machine'],
      cases: [
        {
          id: 'quick-message-actions',
          lifecycle: ['context', 'edit', 'regenerate', 'fork', 'reload'],
          states: ['quickDraft:targeted-mutation', 'capture:retained', 'documents:source-retained'],
          obligations: [
            'edit-targets-exact-user-and-preserves-context',
            'regenerate-reuses-edited-question-and-context',
            'fork-leaves-source-unchanged',
            'fork-restores-copied-context-after-reload',
          ],
        },
      ],
    },
    {
      id: 'personalize-without-losing-work',
      namespace: 'appearance',
      priority: 'P1',
      intent:
        'Keep a draft while changing theme and ambient policy, keep outline icons across surfaces, propagate preferences, reload and continue with Reduce Motion.',
      chain: ['quickDraft', 'shell', 'appearance', 'account'],
      cases: [
        {
          id: 'cross-surface',
          interactions: ['appearance-applied'],
          lifecycle: ['draft', 'settings', 'cross-surface-sync', 'reload', 'continue'],
          states: ['appearance:persisted', 'appearance:reduce-motion', 'quickDraft:retained'],
          obligations: [
            'preferences-propagate',
            'draft-survives-settings-and-reload',
            'motion-policy-disables-shader',
            'keyboard-and-accessibility-usable',
          ],
        },
      ],
    },
    {
      id: 'restart-extension-during-work',
      namespace: 'extension',
      priority: 'P0',
      intent:
        'Authorize through worker transport, preserve an unsent account-scoped NEW draft across extension/profile restart, recover shared background runtime and active-panel subscriptions after worker restart, and keep logout durable; cancellation cannot become success.',
      chain: ['shell', 'transport', 'account', 'connection', 'quickDraft', 'quickDelivery'],
      cases: [
        {
          id: 'background-preconnect',
          lifecycle: [
            'stored-identity',
            'background-connect',
            'panel-open',
            'panel-close',
            'remote-update',
            'worker-restart',
            'active-panel-restart',
            'logout',
          ],
          states: [
            'account:validated-in-worker',
            'connection:shared-workspace',
            'shell:panel-independent',
          ],
          obligations: [
            'stored-identity-connects-without-panel',
            'opening-panels-reuses-workspace-bootstrap',
            'closed-panel-observes-authoritative-update',
            'worker-restart-restores-without-panel',
            'active-panel-reconnect-resubscribes',
            'logout-revokes-all-leases-and-old-data',
          ],
        },
        {
          id: 'profile-restart',
          lifecycle: ['worker-request', 'persist', 'extension-reload', 'profile-restart', 'logout'],
          states: ['account:trusted-storage', 'shell:installed-panel', 'transport:cookies-omitted'],
          obligations: [
            'worker-real-transport',
            'trusted-storage-restricted',
            'identity-and-draft-survive-profile-restart',
            'logout-survives-restart',
          ],
        },
      ],
    },
  ],
  interactions: [
    {
      id: 'update-check',
      journey: 'discover-and-download-update',
      start: 'Trusted click on Check updates in the installed settings surface.',
      end: 'Validated newer version visible in the update status region.',
      attribution: ['release-feed', 'storage', 'browser-main-thread'],
      workload:
        'Packaged extension with a controlled external HTTPS appcast; no real-world latency baseline is implied.',
    },
    {
      id: 'send-feedback',
      journey: 'send-and-continue',
      start: 'Trusted Send click / Enter on ready composer.',
      end: 'A rendered sending/waiting indicator or the submitted user turn.',
      attribution: ['browser-main-thread', 'transport', 'document-sync'],
      workload: 'one first user turn, one visible machine and declared model',
    },
    {
      id: 'first-response',
      journey: 'send-and-continue',
      start: 'Trusted Send click on ready composer.',
      end: 'Non-empty assistant response in the selected conversation viewport.',
      attribution: ['transport', 'document-sync', 'remote-agent', 'browser-main-thread'],
      workload: 'controlled remote reply; external agent time must be reported separately',
    },
    {
      id: 'recovery-confirmed',
      journey: 'recover-ambiguous-send',
      start: 'Trusted click on confirmation after reload.',
      end: 'Recovered user turn visible and uncertainty indicator removed.',
      attribution: ['transport', 'document-sync', 'browser-main-thread'],
      workload: 'first-turn journal after lost confirmation; same request ID',
    },
    {
      id: 'stop-observed',
      journey: 'interrupt-and-resolve-permission',
      start: 'Trusted click on Stop while streaming.',
      end: 'Terminal turn state reflected by a ready Send control.',
      attribution: ['transport', 'machine-command', 'document-sync', 'browser-main-thread'],
      workload: 'active assistant turn; command ACK alone is insufficient',
    },
    {
      id: 'appearance-applied',
      journey: 'personalize-without-losing-work',
      start: 'Trusted theme selection action.',
      end: 'Chosen theme present on the main surface after durable preference publication.',
      attribution: ['browser-main-thread', 'storage'],
      workload: 'mounted settings while a chat draft is retained',
    },
    {
      id: 'capture-preview',
      journey: 'capture-and-send-context',
      start: 'Trusted explicit page/selection capture click.',
      end: 'Captured context chip with preview action visible in the composer.',
      attribution: ['browser-permission', 'tab-extraction', 'browser-main-thread'],
      workload:
        'packaged extension, bounded authored document; permission prompt reported separately',
    },
  ],
};
