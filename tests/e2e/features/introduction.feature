@namespace:introduction
Feature: Host-controlled product introduction
  @journey:intro @transition:workspace>intro @transition:intro>complete @state:intro
  Scenario: Read the introduction at my own pace
    Given I open the workspace
    When I open Intro
    Then I see introduction step "随时问一句"
    When I continue the introduction
    Then I see introduction step "带上网页一起聊"
    When I continue the introduction
    Then I see introduction step "接着上次聊"
    And the page passes accessibility checks
