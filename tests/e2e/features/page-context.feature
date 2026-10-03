@namespace:page-context
Feature: Explicitly attach web context
  @journey:attachment @transition:empty>attached @transition:attached>removed @state:context
  Scenario: Preview the source before sending and remove it
    Given I open the workspace
    Then no context is attached
    When I attach a demo page
    Then I see the attachment source
    When I remove the attachment
    Then no context is attached

  @journey:capture-unavailable @transition:empty>capture-error @state:context @state:failed
  Scenario: Browser preview explains that tab access is unavailable
    Given I open the workspace
    When I request the current page
    Then I see a page access error
    And no context is attached
