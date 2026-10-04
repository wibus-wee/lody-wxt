Feature: Explicit personal context and dictation
  Background:
    Given an isolated product with real HTTP and Streams protocol boundaries

  @namespace:privacy @journey:personal-preferences @case:consent-and-removal @state:privacy:explicitly-enabled @state:documents:preference-in-one-prompt @state:quickDraft:retained @transition:author>enable @transition:enable>reload @transition:reload>send @transition:send>disable @transition:disable>delete
  Scenario: personal-preferences / consent-and-removal
    When I author and enable a personal preference before sending
    Then the product obligations for this segment hold
    When I disable and remove the preference while keeping my next draft
    Then the product obligations for this segment hold

  @namespace:dictation @journey:dictate-and-review @case:service-boundary @state:dictation:denial-visible @state:dictation:reviewed @state:quickDraft:not-sent @transition:open>start @transition:start>denied @transition:denied>retry @transition:retry>review @transition:review>insert
  Scenario: dictate-and-review / service-boundary
    When I open dictation and the browser recognition boundary declines access
    Then the product obligations for this segment hold
    When I retry the controlled recognizer and review text before insertion
    Then the product obligations for this segment hold
