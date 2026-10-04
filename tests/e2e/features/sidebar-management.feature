Feature: Quick sidebar conversation management
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:workspace @journey:manage-durable-conversation @case:quick-sidebar @state:quickDraft:retained @state:documents:metadata-confirmed @state:documents:history-exported @transition:draft>fulltext-search @transition:fulltext-search>rename @transition:rename>archive @transition:archive>reload @transition:reload>restore @transition:restore>export
  Scenario: manage-durable-conversation / quick-sidebar
    When I find a conversation by its body and manage it without losing my quick draft
    Then the product obligations for this segment hold
    When I reload and restore the sidebar conversation and export its history
    Then the product obligations for this segment hold
