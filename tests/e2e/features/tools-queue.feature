Feature: Explicit tools and queued conversation
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:quickChat @journey:send-and-continue @case:tools-and-queue @state:quickDraft:explicit-tools @state:documents:queued @state:connection:capabilities-ready @transition:select-skill>select-connectors @transition:select-connectors>send @transition:send>stream @transition:stream>queue @transition:queue>reload
  Scenario: send-and-continue / tools-and-queue
    When I select a real skill and connectors before explicitly sending
    Then the product obligations for this segment hold
    When I queue a follow-up while the assistant runs and reload the sidebar
    Then the product obligations for this segment hold
