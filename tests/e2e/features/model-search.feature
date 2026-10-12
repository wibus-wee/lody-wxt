Feature: Search provider models before submitting a turn
  @namespace:quickChat @journey:send-and-continue @case:model-search @state:connection:capabilities-ready @state:quickDraft:session-scoped @state:documents:confirmed @transition:inspect>search @transition:search>cancel @transition:cancel>select @transition:select>send
  Scenario: send-and-continue / model-search
    Given an isolated product with an ACP model category and thirty models
    When I search ACP models and recover an empty query
    Then the searched model is selected without sending
    When I send with the searched model
    Then the ACP selection reaches the authoritative turn
