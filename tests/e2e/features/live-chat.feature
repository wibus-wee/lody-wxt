@namespace:conversations
Feature: Live replies through the real stream protocol
  Background:
    Given a controlled account HTTP server
    And a cloud stream containing real historical Loro documents
    And I use a narrow conversation sidebar
    And I open the workspace
    And I sign in and select the test workspace
    And I connect the conversation workspace
    And I open the historical conversation
    When I write the quick draft "A live browser question"
    And I send the quick draft
    Then the cloud contains the submitted question exactly once

  @journey:live-reply @state:sent @state:streaming @state:complete @transition:sent>streaming @transition:streaming>complete
  Scenario: Stream a reply, inspect official tool output and continue chatting
    Then a compact status says "等待助手回复"
    When the assistant starts a live reply
    Then the partial reply is visible with a stop control
    And the composer has no activity status
    And the official tool output can be inspected
    When the assistant completes the live reply
    Then the complete reply allows another message
    And the composer has no activity status
    And the page passes accessibility checks
    When I reload the workspace
    And I connect the conversation workspace
    And I open the historical conversation
    Then the complete reply is restored from the cloud

  @journey:live-permission @state:streaming @state:permission @state:approved @transition:streaming>permission @transition:permission>approved
  Scenario: Approve a permission request once and persist its outcome
    When the assistant requests permission during a live reply
    Then I can approve the permission once
    When the assistant completes the live reply
    Then the complete reply allows another message
    And the page passes accessibility checks

  @journey:live-reconnect @state:streaming @state:disconnected @state:reconnected @transition:streaming>disconnected @transition:disconnected>reconnected
  Scenario: A disconnected stream catches up without losing a draft or duplicating the turn
    When the assistant starts a live reply
    Then the partial reply is visible with a stop control
    When the live stream disconnects
    And I write the quick draft "Keep my next question"
    And the assistant completes the live reply
    And the live stream reconnects
    Then the complete reply is restored from the cloud
    And the quick draft is "Keep my next question"
    And the cloud contains the submitted question exactly once

  @journey:live-invalid-history @state:streaming @state:invalid @state:recovered @transition:streaming>invalid @transition:invalid>recovered
  Scenario: A malformed remote turn shows an error and recovers on the next valid update
    When the assistant starts a live reply
    Then the partial reply is visible with a stop control
    When the cloud sends a turn with a missing identity
    Then the history error identifies the damaged field
    When the cloud repairs the turn identity
    Then the partial reply is visible with a stop control
    And the recovered conversation has no error

  @journey:live-cancelled @state:streaming @state:cancelled @transition:streaming>cancelled
  Scenario: The official canceled status ends the active reply and preserves its content
    When the assistant starts a live reply
    Then the partial reply is visible with a stop control
    When the assistant reports that the reply was canceled
    Then the canceled reply preserves its partial content

  @journey:stop-reply @state:streaming @state:cancelled @transition:streaming>cancelled
  Scenario: Stop sends the active turn identity through the machine RPC
    When the assistant starts a live reply
    Then the partial reply is visible with a stop control
    When I stop the active reply
    Then the canceled reply preserves its partial content
    And the machine receives one cancellation for the active turn

  @journey:stop-failure @state:streaming @state:command-failed @transition:streaming>command-failed
  Scenario: A denied command response stream releases the composer and reports the failure
    When the assistant starts a live reply
    Then the partial reply is visible with a stop control
    When the command response stream is denied
    And I stop the active reply
    Then the stop failure is visible and editing is available

  @journey:delivery-recovery @state:sent @state:unconfirmed @state:confirmed @transition:sent>unconfirmed @transition:unconfirmed>confirmed
  Scenario: Recover an acknowledged turn after interrupted local cleanup without sending it twice
    When I reload with an unresolved journal for the submitted turn
    Then one delivery notice retains my draft
    When I confirm the delivery result
    Then the original delivery is confirmed without another turn
    And the page passes accessibility checks
