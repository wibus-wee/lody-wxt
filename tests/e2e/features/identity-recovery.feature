Feature: Identity boundaries during active conversation work
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:identity @journey:change-identity-during-work @case:workspace-switch @state:account:new-workspace @state:quickDraft:isolated @state:connection:old-closed @transition:start>switch-scope @transition:switch-scope>late-completion @transition:late-completion>return
  Scenario: change-identity-during-work / workspace-switch
    When I switch workspaces while my original conversation is streaming
    Then the product obligations for this segment hold
    When the original workspace finishes and I return to its saved question
    Then the product obligations for this segment hold

  @namespace:identity @journey:change-identity-during-work @case:token-expiry @state:account:expired @state:connection:closed @transition:stream>expire @transition:expire>late-completion
  Scenario: change-identity-during-work / token-expiry
    When my authorization expires while a conversation is streaming
    Then the product obligations for this segment hold
    When its late reply arrives and I authorize this device again
    Then the product obligations for this segment hold
