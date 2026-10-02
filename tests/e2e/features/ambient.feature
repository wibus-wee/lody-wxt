@namespace:ambient
Feature: Respect system motion preferences
  @journey:reduced-motion @transition:ambient>reduced @state:ambient @state:reduced-motion
  Scenario: Reduce Motion suppresses decorative shaders
    Given I prefer reduced motion
    And I open the workspace
    When I open Settings
    And I enable ambient effects
    And I return to Workspace
    Then ambient effects are absent
    And the page passes accessibility checks
