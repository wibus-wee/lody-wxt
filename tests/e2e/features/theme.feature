@namespace:preferences
Feature: Lody sidebar palettes
  @journey:sidebar-theme @state:theme @state:narrow @transition:light>dark @transition:dark>restored
  Scenario: Light and dark choices persist in a narrow sidebar
    Given I open the workspace
    When I select the Lody theme "light"
    Then the Lody shell uses theme "light"
    When I select the Lody theme "dark"
    Then the Lody shell uses theme "dark"
    When I reload the workspace
    Then the Lody shell uses theme "dark"
    And the page passes accessibility checks
