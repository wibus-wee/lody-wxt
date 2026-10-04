Feature: Official composer commands and mentions
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:automations @journey:synced-shortcuts @case:composer-mentions @state:automations:resource-authorized @state:quickDraft:source-ranges @state:quickDraft:filled-not-sent @state:quickDelivery:single-prompt @transition:live-index>slash-search @transition:slash-search>keyboard-insert @transition:keyboard-insert>draft-reload @transition:draft-reload>session-mention @transition:session-mention>skill-expand-send
  Scenario: synced-shortcuts / composer-mentions
    When I search synchronized commands at the caret and cancel composition safely
    Then the product obligations for this segment hold
    When I retain selected skill and session mentions across reload and send one question
    Then the product obligations for this segment hold

  @namespace:automations @journey:synced-shortcuts @case:upstream-navigation @state:quickDraft:category-navigation @state:quickDraft:source-ranges @state:automations:scope-verified @state:quickDelivery:single-prompt @transition:categories>keyboard-drilldown @transition:keyboard-drilldown>navigate-back @transition:navigate-back>touch-select @transition:touch-select>canonical-command @transition:canonical-command>shortcut-prepare @transition:shortcut-prepare>atomic-edit @transition:atomic-edit>send
  Scenario: synced-shortcuts / upstream-navigation
    When I navigate the original mention categories by keyboard and touch
    Then the product obligations for this segment hold
    When I apply a scoped shortcut with structured mentions using the original editing rules
    Then the product obligations for this segment hold
