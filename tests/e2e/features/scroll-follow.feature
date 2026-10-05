Feature: Reader intent survives conversation output and layout changes
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:quickChat @journey:send-and-continue @case:reader-scroll @state:chatScroll:following @state:chatScroll:reading @state:documents:streaming-work @transition:inspect>stream @transition:stream>read-history @transition:read-history>resize @transition:resize>jump @transition:jump>reload
  Scenario: send-and-continue / reader-scroll
    When I select text and inspect a short conversation without leaving its latest content
    Then the product obligations for this segment hold
    When I read upward during streamed output and return to the latest content after layout changes
    Then the product obligations for this segment hold
    When I reload my reading position before its conversation finishes loading
    Then the product obligations for this segment hold
