@namespace:connection
Feature: Connection identity and data boundaries
  @journey:connection-isolation @transition:demo>real-unavailable @transition:real-unavailable>demo @state:connection @state:history
  Scenario: Real mode cannot silently fall back to demonstration data
    Given I open the workspace
    When I send "只存在演示账户"
    Then the Agent completes its reply
    When I select real Lody mode
    Then I see the real connection blocker
    And I do not see the message "只存在演示账户"
    When I select demonstration mode
    Then I see my message "只存在演示账户"
