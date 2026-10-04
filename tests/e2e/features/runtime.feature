@namespace:conversations
Feature: Cloud conversation history
  @journey:agent-identity @state:ready @state:selector @transition:ready>selector
  Scenario Outline: Agent identity drives brand icons throughout a narrow composer
    Given a controlled account HTTP server
    And a cloud assistant identified by "<cli>" "<agent>" with provider "<provider>"
    And I use a narrow conversation sidebar
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    Then the composer and assistant selectors show the "<glyph>" glyph
    And the page passes accessibility checks

    Examples:
      | cli      | agent    | provider                | glyph           |
      | builtin  | codex    |                         | openai          |
      | builtin  | claude   |                         | anthropic       |
      | builtin  | claude   | deepseek                | deepseek        |
      | builtin  | claude   | https://api.minimaxi.com | minimax         |
      | builtin  | claude   | mimo                    | mimo            |
      | registry | gemini   |                         | registry:gemini |
      | custom   | my-agent |                         | terminal        |
      | registry | unknown  |                         | agent           |

  @journey:recent-history @state:connected @state:history @transition:connected>history
  Scenario: Recently active conversations precede newer but quiet conversations
    Given a controlled account HTTP server
    And cloud conversations with separate creation and activity times
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    Then recent history sorts by the last message time

  @journey:history @state:signed-in @state:connected @state:history @transition:signed-in>connected @transition:connected>history
  Scenario: Open an existing conversation from real cloud snapshots
    Given a controlled account HTTP server
    And a cloud stream containing real historical Loro documents
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    And I open the historical conversation
    Then the runtime renders cloud history and enables reply controls

  @journey:model-configuration @state:signed-in @state:connected @state:model-a @state:model-b @transition:model-a>model-b
  Scenario: Switching models uses each model's declared controls
    Given a controlled account HTTP server
    And a cloud stream with per-model capability declarations
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    Then switching models updates effort choices and Fast availability
    And the page passes accessibility checks

  @journey:permission-default @state:ready @state:sent @transition:ready>sent
  Scenario Outline: The declared permission default is submitted consistently
    Given a controlled account HTTP server
    And a cloud stream exposing the "<field>" permission configuration
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    And I open the historical conversation
    Then the permission picker shows "Ask"
    When I write the quick draft "Permission configuration question"
    And I send the quick draft
    Then the submitted "<field>" permission is "ask" in both representations

    Examples:
      | field  |
      | mode   |
      | modeId |

  @journey:permission-switch @state:ready @state:changed @state:sent @transition:ready>changed @transition:changed>sent
  Scenario Outline: Both permission controls stay synchronized before sending
    Given a controlled account HTTP server
    And a cloud stream exposing the "<field>" permission configuration
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    And I open the historical conversation
    Then the permission picker shows "Ask"
    When I choose permission "Read-only"
    Then the runtime mode shows "Read-only"
    When I choose runtime mode "Ask"
    Then the permission picker shows "Ask"
    When I choose permission "Read-only"
    And I write the quick draft "Permission configuration question"
    And I send the quick draft
    Then the submitted "<field>" permission is "read-only" in both representations
    And the page passes accessibility checks

    Examples:
      | field  |
      | mode   |
      | modeId |

  @journey:permission-config-only @state:ready @state:sent @transition:ready>sent
  Scenario: A mode configuration can be sent without a legacy mode declaration
    Given a controlled account HTTP server
    And a cloud stream exposing only runtime mode configuration
    And I open the workspace
    And I sign in and select the test workspace
    When I connect the conversation workspace
    And I open the historical conversation
    And I choose runtime mode "Read-only"
    And I write the quick draft "Permission configuration question"
    And I send the quick draft
    Then the runtime mode is submitted without a legacy mode
