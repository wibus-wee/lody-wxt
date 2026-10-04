@namespace:conversations
Feature: Durable official Lody conversation history
  @journey:history-reopen @state:signed-in @state:history @transition:history>reopened
  Scenario: Reopen real cloud conversation history after reload
    Given a controlled account HTTP server
    And a cloud stream containing real historical Loro documents
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    And I open the historical conversation
    Then the cloud history uses the Lody chat surface
    When I reload the workspace
    And I connect the conversation workspace
    And I open the historical conversation
    Then the cloud history uses the Lody chat surface
