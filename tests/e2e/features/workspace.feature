@namespace:preferences
Feature: Personal workspace preferences
  @journey:mood @transition:workspace>personalized @state:mood
  Scenario Outline: Change and persist the "<mood>" icon mood
    Given I open the workspace
    When I choose the "<mood>" mood
    Then the workspace uses "<mood>" icons
    When I reload the workspace
    Then the workspace uses "<mood>" icons
    And the page passes accessibility checks

    Examples:
      | mood    |
      | outline |
      | duotone |
      | fill    |
      | pixel   |
      | glass   |

  @journey:name @transition:workspace>settings @transition:settings>renamed @state:name
  Scenario: Save a personal name
    Given I open the workspace
    When I open Settings
    And I save the name "Quiet corner"
    And I return to Workspace
    Then I see the workspace name "Quiet corner"
    When I reload the workspace
    Then I see the workspace name "Quiet corner"

  @journey:validation @transition:settings>invalid @state:validation
  Scenario: Reject a blank name
    Given I open the workspace
    When I open Settings
    And I save the name " "
    Then I see a name validation error
    And the page passes accessibility checks

  @journey:fusion @transition:personalized>renamed @state:mood @state:name @state:ambient
  Scenario: Compose mood, name and ambient preferences
    Given I open the workspace
    When I choose the "duotone" mood
    And I open Settings
    And I save the name "Studio"
    And I enable ambient effects
    And I return to Workspace
    And I reload the workspace
    Then the workspace uses "duotone" icons
    And I see the workspace name "Studio"
    And ambient effects are visible

  @journey:recovery @transition:corrupt>workspace @state:recovery
  Scenario: Recover invalid stored preferences
    Given my stored preferences are corrupted
    When I reload the workspace
    Then the workspace uses "outline" icons
    And I see the workspace name "Your workspace"
