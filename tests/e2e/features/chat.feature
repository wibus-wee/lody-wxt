@namespace:conversations
Feature: Real cloud history in the Lody chat surface
  @journey:chat-cloud-history @state:signed-in @state:history @state:narrow @transition:connected>chat @transition:code>wrapped
  Scenario: Render real Loro history through Lody message and composer controls
    Given a controlled account HTTP server
    And a cloud stream containing real historical Loro documents
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    And I open the historical conversation
    Then the cloud history uses the Lody chat surface
    When I wrap the cloud reply code
    Then the cloud transcript stays inside a narrow sidebar
    And the page passes accessibility checks
