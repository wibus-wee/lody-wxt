Feature: Exact message actions in the compact conversation
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:workspace @journey:edit-fork-and-delete @case:quick-message-actions @state:quickDraft:targeted-mutation @state:capture:retained @state:documents:source-retained @transition:context>edit @transition:edit>regenerate @transition:regenerate>fork @transition:fork>reload
  Scenario: edit-fork-and-delete / quick-message-actions
    When I edit a historical question with its attached page in the compact conversation
    Then the product obligations for this segment hold
    When I regenerate the edited question and fork its completed response across reload
    Then the product obligations for this segment hold
