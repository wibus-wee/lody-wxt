Feature: Advanced conversation mutations and delivery recovery
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:workspace @journey:edit-fork-and-delete @case:confirmed @state:documents:source-retained @state:machine:fork-deleted @transition:edit>fork @transition:fork>confirm-delete @transition:confirm-delete>reload
  Scenario: edit-fork-and-delete / confirmed
    When I edit my owned turn and fork its completed response in the workspace
    Then the product obligations for this segment hold
    When I confirm deletion of only that fork and reload the workspace
    Then the product obligations for this segment hold

  @namespace:workspace @journey:queue-steer-and-recover @case:ambiguous-guide @state:machine:active-turn @state:advanced:journal-retained @state:documents:request-confirmed @transition:queue>guide @transition:guide>failure @transition:failure>reload @transition:reload>reconcile
  Scenario: queue-steer-and-recover / ambiguous-guide
    When I queue a follow-up and lose confirmation of a steer to the active workspace turn
    Then the product obligations for this segment hold
    When I reload and reconcile the original steer without dispatching it again
    Then the product obligations for this segment hold
