Feature: Concurrent quick conversation delivery
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:quickChat @journey:recover-ambiguous-send @case:cross-surface @state:quickDelivery:shared-lock @state:documents:single-admission @transition:claim>concurrent-send @transition:concurrent-send>reconcile
  Scenario: recover-ambiguous-send / cross-surface
    When the first conversation surface claims an in-flight delivery
    Then the product obligations for this segment hold
    When the other surface tries to submit the same draft
    Then both surfaces reconcile exactly one admitted turn
