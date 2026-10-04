Feature: Product lifecycle assurance
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:identity @journey:authorize-and-resume @case:durable @state:account:signed-in @state:connection:workspace-bound @state:quickDraft:restored @transition:authorize>persist @transition:persist>reload
  Scenario: authorize-and-resume / durable
    When I follow "authorize, choose a workspace and write a question"
    Then the product obligations for this segment hold
    When I follow "navigate through settings, reload and return to my question"
    Then the product obligations for this segment hold

  @namespace:identity @journey:authorize-and-resume @case:restore-outage @state:account:validation-error @state:account:credentials-retained @state:connection:reconnected @transition:reload>failure @transition:failure>recover
  Scenario: authorize-and-resume / restore-outage
    When I follow "reload my saved question while identity validation is unavailable"
    Then the product obligations for this segment hold
    When I follow "retry validation and resume the retained question without a device login"
    Then the product obligations for this segment hold

  @namespace:identity @journey:cancel-authorization @case:late-token @state:account:cancelled @state:account:new-generation @transition:authorize>cancel @transition:cancel>late-completion @transition:late-completion>restart
  Scenario: cancel-authorization / late-token
    When I follow "cancel authorization after the token request starts and release its late success"
    Then the product obligations for this segment hold
    When I follow "authorize a fresh generation and send a usable question"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:send-and-continue @case:configured @state:connection:capabilities-ready @state:quickDraft:session-scoped @state:documents:confirmed @transition:create>send @transition:send>stream @transition:stream>route-hide @transition:route-hide>history-open @transition:history-open>continue @performance
  Scenario: send-and-continue / configured
    When I follow "choose permission configuration and send my first question"
    Then the product obligations for this segment hold
    When I follow "retain my session through settings and continue it from history"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:recover-ambiguous-send @case:first-turn @state:quickDelivery:unconfirmed @state:quickDraft:retained @state:documents:metadata-and-turn-confirmed @transition:persist>partial-write @transition:partial-write>reload @transition:reload>reconcile @transition:reconcile>continue @performance
  Scenario: recover-ambiguous-send / first-turn
    When I follow "send a first question whose write succeeds but confirmation is lost"
    Then the product obligations for this segment hold
    When I follow "reload, reconcile the original request and continue only after confirmation"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:recover-ambiguous-send @case:corrupt-record @state:quickDelivery:unreadable @state:quickDraft:retained @transition:persist>corrupt @transition:corrupt>reload @transition:reload>fail-closed
  Scenario: recover-ambiguous-send / corrupt-record
    When I follow "reload with an unreadable delivery record and an unsent question"
    Then the product obligations for this segment hold
    When I follow "visit settings and retry reading without replacing the corrupt record"
    Then the product obligations for this segment hold

  @namespace:identity @journey:change-identity-during-work @case:logout-other-surface @state:account:signed-out @state:connection:closed @state:quickDraft:scoped-retained @transition:stream>cross-surface-logout @transition:cross-surface-logout>reload @transition:reload>relogin
  Scenario: change-identity-during-work / logout-other-surface
    When I follow "start streaming while a separate surface logs out this device"
    Then the product obligations for this segment hold
    When I follow "receive the old stream completion, reload and sign in again"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:interrupt-and-resolve-permission @case:permission-stop @state:machine:permission-pending @state:documents:permission-resolved @state:machine:stopped @transition:stream>permission @transition:permission>stop-request @transition:stop-request>terminal-observed @transition:terminal-observed>continue @performance
  Scenario: interrupt-and-resolve-permission / permission-stop
    When I follow "send, inspect partial work and authorize its exact permission request"
    Then the product obligations for this segment hold
    When I follow "stop the active turn, observe its terminal state and send a continuation"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:interrupt-and-resolve-permission @case:stop-unconfirmed @state:machine:stop-unconfirmed @state:documents:still-active @transition:stream>stop-request @transition:stop-request>failure @transition:failure>reread
  Scenario: interrupt-and-resolve-permission / stop-unconfirmed
    When I follow "request a stop while its command response stream is denied"
    Then the product obligations for this segment hold
    When I follow "reread the actual active turn and stop only after the command boundary recovers"
    Then the product obligations for this segment hold

  @namespace:workspace @journey:manage-durable-conversation @case:archive-restore @state:documents:archived @state:advanced:history-retained @transition:search>metadata-write @transition:metadata-write>archive @transition:archive>reload @transition:reload>restore
  Scenario: manage-durable-conversation / archive-restore
    When I follow "find a conversation, rename and pin it, then archive it"
    Then the product obligations for this segment hold
    When I follow "reload the archived conversation, restore it and continue from its original history"
    Then the product obligations for this segment hold

  @namespace:appearance @journey:personalize-without-losing-work @case:cross-surface @state:appearance:persisted @state:appearance:reduce-motion @state:quickDraft:retained @transition:draft>settings @transition:settings>cross-surface-sync @transition:cross-surface-sync>reload @transition:reload>continue @performance
  Scenario: personalize-without-losing-work / cross-surface
    When I follow "keep a question while changing theme, icon mood and ambient policy"
    Then the product obligations for this segment hold
    When I follow "reload, return by keyboard and continue the draft with reduced motion"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:send-and-continue @case:inspect-work @state:documents:streaming-work @state:documents:finished-answer @state:quickDraft:retained @transition:stream>inspect @transition:inspect>complete @transition:complete>reload @transition:reload>continue
  Scenario: send-and-continue / inspect-work
    When I follow "read a long streamed turn and inspect its grouped command details"
    Then the product obligations for this segment hold
    When I follow "observe the final answer, reload the same history and retain my next question"
    Then the product obligations for this segment hold

  @namespace:workspace @journey:edit-fork-and-delete @case:delete-unconfirmed @state:machine:delete-unconfirmed @state:advanced:error-visible @transition:confirm-delete>failure @transition:failure>reload @transition:reload>reconcile
  Scenario: edit-fork-and-delete / delete-unconfirmed
    When I follow "confirm deletion of a conversation while the machine write is denied"
    Then the product obligations for this segment hold
    When I follow "reload and reconcile surviving history without inventing remote deletion"
    Then the product obligations for this segment hold

  @namespace:quickChat @journey:interrupt-and-resolve-permission @case:inspect-stopped-work @state:documents:partial-work-retained @state:machine:stopped @state:quickDraft:retained @transition:stream>inspect @transition:inspect>stop-request @transition:stop-request>terminal-observed @transition:terminal-observed>reload @transition:reload>continue
  Scenario: interrupt-and-resolve-permission / inspect-stopped-work
    When I follow "inspect partial command work, keep a next question and stop the real active turn"
    Then the product obligations for this segment hold
    When I follow "reload the stopped work, inspect its retained details and continue the next question"
    Then the product obligations for this segment hold

  @namespace:attachments @journey:attach-reload-and-send @case:file-first-turn @state:attachmentDrafts:durable @state:quickDelivery:one-turn @state:documents:confirmed @transition:attach>reload @transition:reload>upload @transition:upload>send @transition:send>confirm
  Scenario: attach-reload-and-send / file-first-turn
    When I retain a local attachment across reload with "working" upload service
    Then the product obligations for this segment hold
    When I send the restored attachment with "first" delivery
    Then the product obligations for this segment hold

  @namespace:attachments @journey:attach-reload-and-send @case:failed-upload @state:attachmentDrafts:retained @state:quickDraft:retained @state:documents:confirmed @transition:attach>upload @transition:upload>failure @transition:failure>reload @transition:reload>retry @transition:retry>confirm
  Scenario: attach-reload-and-send / failed-upload
    When I retain a local attachment across reload with "failing" upload service
    Then the product obligations for this segment hold
    When I send the restored attachment with "retry" delivery
    Then the product obligations for this segment hold
