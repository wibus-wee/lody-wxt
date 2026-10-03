@namespace:conversations
Feature: Isolated and durable Lody conversations
  @journey:session-isolation @transition:streaming>another-session @transition:another-session>restored @state:history @state:streaming @state:draft
  Scenario: An old response never enters a new conversation
    Given I open the workspace
    When I send "第一条会话消息"
    Then I receive streamed text
    When I create a Lody conversation
    Then there are no sent messages
    When I send "第二条会话消息"
    Then the Agent completes its reply
    And I do not see the message "第一条会话消息"
    When I switch to conversation "第一条会话消息"
    Then I see my message "第一条会话消息"
    And I do not see the message "第二条会话消息"

  @journey:project-match @transition:attached>project-session @state:context @state:project
  Scenario: Opt in to a matching GitHub project from the machine catalog
    Given I open the workspace
    When I enable GitHub project matching
    And I create a Lody conversation
    And I attach a demo page
    And I send "在项目里继续"
    Then the Agent completes its reply
    And my execution target includes "LodyAI/lody"
