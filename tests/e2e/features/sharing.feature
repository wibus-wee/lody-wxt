Feature: Explicit fixed conversation snapshots with recoverable publication
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:sharing @journey:publish-recover-revoke @case:frozen-deployment @state:sharing:explicitly-confirmed @state:sharing:durable-deployment @state:documents:public-access-revoked @transition:capture>preview @transition:preview>begin @transition:begin>upload-failure @transition:upload-failure>reload @transition:reload>same-deployment-resume @transition:same-deployment-resume>published-query @transition:published-query>revoke-query
  Scenario: publish-recover-revoke / frozen-deployment
    When I preview a sanitized conversation and retain a failed share upload
    Then the product obligations for this segment hold
    When I recover the frozen publication, reset its link and revoke public access
    Then the product obligations for this segment hold
