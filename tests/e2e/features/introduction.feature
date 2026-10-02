@namespace:introduction
Feature: Host-controlled product introduction
  @journey:intro @transition:workspace>intro @transition:intro>complete @state:intro
  Scenario: Read the introduction at my own pace
    Given I open the workspace
    When I open Intro
    Then I see introduction step "Welcome"
    When I continue the introduction
    Then I see introduction step "Make it yours"
    When I continue the introduction
    Then I see introduction step "Ready"
    And the page passes accessibility checks
