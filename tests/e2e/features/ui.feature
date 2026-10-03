@namespace:custom-ui
Feature: Lody UI theme and keyboard navigation
  @journey:run-configuration @transition:default>configured @transition:configured>restored @transition:restored>sent @state:narrow @state:keyboard @state:run-config @state:persistence
  Scenario: Original run configuration searches models and persists real draft selections
    Given I open the workspace
    When I use a narrow sidebar
    And I choose run model "6 Astra" using search "astra"
    And I choose reasoning "Ultra"
    And I enable run mode "Plan"
    And I enable run mode "Fast"
    Then the page passes accessibility checks
    When I close the composer configuration
    Then the message input has focus
    When I reload the workspace
    Then the run configuration is "6 Astra" with reasoning "Ultra"
    When I send "按照配置规划"
    Then the Agent completes its reply
    And the accepted configuration is "gpt-6-astra" with reasoning "ultra"
    And the Agent identifies the demo configuration "6 Astra · Ultra · Plan · Fast"

  @journey:run-config-capability @transition:ultra>medium @state:narrow @state:run-config @state:capability
  Scenario: Switching to a model without Ultra reconciles the reasoning options
    Given I open the workspace
    When I use a narrow sidebar
    And I choose reasoning "Ultra"
    And I choose run model "6 Luna" using search "luna"
    Then the run configuration is "6 Luna" with reasoning "Medium"
    And Ultra reasoning is unavailable
    And the page passes accessibility checks

  @journey:run-config-retry @transition:configured>failed @transition:failed>edited @transition:edited>retried @state:run-config @state:failed @state:retry @state:draft
  Scenario: Retry preserves the failed turn configuration while a draft can choose another model
    Given I open the workspace
    When I choose run model "6 Astra" using search "astra"
    And I enable run mode "Fast"
    And I close the composer configuration
    And I simulate a failed send
    And I send "保留本次模型"
    Then sending fails and the draft is "保留本次模型"
    When I choose run model "6 Luna" using search "luna"
    And I write a draft "下一次用 Luna"
    And I retry sending
    Then the Agent completes its reply
    And the accepted configuration is "gpt-6-astra" with reasoning "medium"
    And the draft remains "下一次用 Luna"
    And the run configuration is "6 Luna" with reasoning "Medium"

  @journey:narrow-theme @transition:light>dark @transition:dark>system @state:theme @state:keyboard @state:narrow
  Scenario: A narrow sidebar supports both palettes and keyboard controls
    Given I open the workspace
    When I use a narrow sidebar
    And I choose theme "light"
    Then the page uses theme "light"
    And the page passes accessibility checks
    When I choose theme "dark"
    Then the page uses theme "dark"
    And the page passes accessibility checks
    When I choose theme "system"
    Then the page uses theme "system"
    And keyboard focus is visible
    And there is no horizontal overflow

  @journey:sidebar-composer @transition:empty>draft @state:narrow @state:composer @state:draft
  Scenario: The sidebar retains Lody composer geometry and shortcut focus
    Given I open the workspace
    When I use a narrow sidebar
    Then the chat composer stays inside the viewport
    And the composer matches Lody resting geometry
    When I choose the task suggestion "总结这篇网页"
    Then the draft remains "总结这篇文章的要点"
    And the chat composer stays inside the viewport
    And there is no horizontal overflow
    And the page passes accessibility checks

  @journey:composer-controls @transition:closed>configuration @transition:configuration>closed @transition:closed>permission @state:narrow @state:keyboard @state:composer
  Scenario: Composer controls disclose the available runtime and read-only context boundary
    Given I open the workspace
    When I use a narrow sidebar
    And I inspect the composer configuration
    Then the page passes accessibility checks
    When I close the composer configuration
    Then the message input has focus
    When I inspect the Agent permission menu
    Then the page passes accessibility checks
    When I close the composer configuration
    Then the message input has focus
    When I inspect the context permission
    Then the page passes accessibility checks
    When I close the context permission
    And I focus the composer frame
    Then the message input has focus
    And the composer matches Lody resting geometry

  @journey:composer-permission @transition:auto>full-access @transition:full-access>restored @transition:restored>read-only @transition:read-only>sent @state:narrow @state:permission @state:keyboard @state:persistence
  Scenario: Lody permission choices close the menu, restore prompt focus and persist in the turn
    Given I open the workspace
    When I use a narrow sidebar
    And I choose Agent permission "Full access"
    Then the page passes accessibility checks
    When I reload the workspace
    Then the Agent permission remains "Full access"
    When I choose Agent permission "Read-only"
    And I send "检查权限配置"
    Then the Agent completes its reply
    And the accepted permission mode is "read-only"
    And the Agent permission remains "Read-only"

  @journey:composer-attachments @transition:empty>attached @transition:attached>preview @transition:preview>draft @state:narrow @state:context @state:composer @state:draft
  Scenario: In-frame attachment tiles preserve source details and a growing input
    Given I open the workspace
    When I use a narrow sidebar
    And I attach a demo page
    Then attachment tiles are inside the composer
    And I see the attachment source
    When I expand the composer with a long draft
    Then the draft input scrolls within its height limit
    And the chat composer stays inside the viewport
    And there is no horizontal overflow
    And the page passes accessibility checks
