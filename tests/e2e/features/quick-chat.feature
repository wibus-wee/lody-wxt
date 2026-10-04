@namespace:conversations
Feature: A conversation first browser sidebar
  Background:
    Given a controlled account HTTP server
    And a cloud stream containing real historical Loro documents
    And I open the workspace
    And I sign in and select the test workspace
    And I connect the conversation workspace

  @journey:quick-start @state:signed-in @state:new-chat @transition:connected>ready
  Scenario: A single available assistant is ready without a setup dialog
    Then the quick chat is ready without setup
    When I start a fresh quick chat
    Then no empty conversation has been created
    And the page passes accessibility checks

  @journey:chat-draft @state:draft @state:history @transition:draft>settings @transition:settings>draft @transition:draft>history @transition:history>draft
  Scenario: Drafts survive settings and switching conversations
    When I write the quick draft "Keep this thought"
    And I open Settings
    And I return to Workspace
    Then the quick draft is "Keep this thought"
    When I open the historical conversation
    And I write the quick draft "A reply draft"
    And I start a fresh quick chat
    Then the quick draft is "Keep this thought"
    When I open the historical conversation
    Then the quick draft is "A reply draft"

  @journey:chat-search @state:history @transition:history>filtered @transition:filtered>opened
  Scenario: Search history and reopen a conversation
    When I search quick history for "not a match"
    Then quick history has no matches
    When I search quick history for "historical"
    And I open the matching quick conversation
    Then the cloud history uses the Lody chat surface

  @journey:sidebar-draft @state:narrow @state:draft @transition:empty>long-draft
  Scenario: A long draft leaves send and navigation reachable in a short sidebar
    When I write a long draft in a short sidebar
    Then the quick chat controls fit the viewport
    And the page passes accessibility checks

  @journey:quick-send @state:new-chat @state:sent @transition:draft>sent
  Scenario: The first message creates the conversation
    Then the quick chat is ready without setup
    When I write the quick draft "A new browser question"
    And I send the quick draft
    Then the first quick message is in the transcript

  @journey:legacy-empty-chat @state:draft @state:legacy-reservation @transition:reload>ready @transition:draft>sent
  Scenario: An old empty conversation does not block an unsent webpage question
    When I reopen a sidebar with an old empty reservation and a webpage draft
    Then the quick chat is ready without setup
    And the unsent draft has no recovery warning
    When I send the quick draft
    Then the first quick message is in the transcript
    And the first webpage question reaches the cloud in one text input
    And the attached message fits narrow sidebars
    And the page passes accessibility checks

  @journey:compact-connection @state:connecting @state:ready @transition:connecting>ready
  Scenario: Connecting uses a small status beside the composer and clears when ready
    When I reconnect with a delayed workspace in a short sidebar
    Then a compact status says "连接工作区"
    And the page passes accessibility checks
    When the workspace connection completes
    Then the quick chat is ready without setup
    And the composer has no activity status

  @journey:attached-prompt @state:draft @state:sent @state:restored @transition:draft>sent @transition:sent>restored
  Scenario: Page and selection references travel with the question in one text input
    When I open the historical conversation
    And I restore a draft with page and selection references
    And I connect the conversation workspace
    And I open the historical conversation
    And I send the quick draft
    Then the cloud receives the question and references as one complete prompt
    And the attached question displays once with both source badges
    When I reload the workspace
    And I connect the conversation workspace
    And I open the historical conversation
    Then the attached question displays once with both source badges
    And the cloud receives the question and references as one complete prompt
    And the page passes accessibility checks
