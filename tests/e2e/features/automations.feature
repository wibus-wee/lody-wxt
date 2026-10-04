Feature: Reusable prompts and machine-owned scheduled work
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:automations @journey:workflow-lifecycle @case:synced-shortcut @state:automations:resource-authorized @state:automations:revision-synced @state:automations:shared-readonly @state:quickDraft:filled-not-sent @transition:desktop-source>authorize @transition:authorize>edit @transition:edit>reload @transition:reload>use @transition:use>share @transition:share>delete
  Scenario: workflow-lifecycle / synced-shortcut
    When I discover Desktop private and shared shortcuts through scoped grants
    Then the product obligations for this segment hold
    When I edit, restore, use and share a synchronized shortcut without sending
    Then the product obligations for this segment hold
    When I delete my synchronized shortcut and check private isolation
    Then the product obligations for this segment hold

  @namespace:automations @journey:workflow-lifecycle @case:legacy-migration @state:automations:legacy-local @state:automations:migration-explicit @state:automations:revision-synced @transition:legacy-draft>preview @transition:preview>cancel @transition:cancel>confirm @transition:confirm>reload
  Scenario: workflow-lifecycle / legacy-migration
    When I preview and cancel migration of a legacy local shortcut
    Then the product obligations for this segment hold
    When I explicitly migrate the legacy shortcut and restore its synchronized copy
    Then the product obligations for this segment hold

  @namespace:automations @journey:schedule-recovery @case:cloud-publication @state:automations:pending @state:documents:schedule-synced @state:machine:runtime-observed @transition:stage>publish-failure @transition:publish-failure>reload @transition:reload>same-id-recovery @transition:same-id-recovery>runtime-observed
  Scenario: schedule-recovery / cloud-publication
    When I stage a schedule whose registry publication fails
    Then the product obligations for this segment hold
    When I reload and recover the exact schedule mutation then observe machine status
    Then the product obligations for this segment hold
