@namespace:chat
Feature: Talk to a Lody Agent in the sidebar
  @journey:chat-chain @transition:empty>session @transition:session>attached @transition:attached>streaming @transition:streaming>stopped @transition:stopped>restored @state:streaming @state:context @state:history
  Scenario: Create, attach, send, stop and reopen history
    Given I open the workspace
    When I create a Lody conversation
    And I attach a demo page
    And I send "阅读这份资料"
    Then I receive streamed text
    When I stop the Agent
    Then the received text is retained
    When I reload the workspace
    Then I see my message "阅读这份资料"
    And the received text is retained
    And the page passes accessibility checks

  @journey:retry @transition:session>failed @transition:failed>complete @state:draft @state:failed @state:streaming
  Scenario: Failed output keeps the draft and retries the same turn
    Given I open the workspace
    When I create a Lody conversation
    And I simulate a failed send
    And I send "保留我的草稿"
    Then sending fails and the draft is "保留我的草稿"
    When I reload the workspace
    Then sending fails and the draft is "保留我的草稿"
    When I retry sending
    Then the Agent completes its reply
    And there is one user message
    And the composer is empty

  @journey:retry-draft-isolation @transition:failed>complete @state:draft @state:failed @state:history
  Scenario: Retrying an old turn does not consume a new draft
    Given I open the workspace
    When I simulate a failed send
    And I send "原来的失败消息"
    Then sending fails and the draft is "原来的失败消息"
    When I write a draft "下一轮还没发送"
    And I retry sending
    Then the Agent completes its reply
    And there is one user message
    And I see my message "原来的失败消息"
    And the draft remains "下一轮还没发送"

  @journey:ime @transition:draft>complete @state:keyboard @state:draft
  Scenario: Composition and Shift Enter do not submit prematurely
    Given I open the workspace
    When I compose Chinese text
    Then there are no sent messages
    When I send the composer with Enter
    Then the Agent completes its reply

  @journey:reading @transition:streaming>reading @transition:reading>latest @state:streaming @state:scroll
  Scenario: Streaming respects a reader who scrolled up
    Given I open the workspace
    When I send a long message
    And I expand the long user message
    And I scroll up during generation
    Then I can return to the latest message

  @journey:safe-markdown @transition:draft>complete @state:security
  Scenario: Untrusted HTML and unsafe links are inert
    Given I open the workspace
    When I send "<script>alert(1)</script> [click](javascript:alert(1))"
    Then the Agent completes its reply
    And unsafe Markdown is inert

  @journey:message-surface @transition:folded>expanded @transition:code-scroll>code-wrap @transition:code>preview @state:narrow @state:history @state:keyboard @state:context
  Scenario: Lody message rows preserve folding, content rails and code controls
    Given I open the workspace
    When I use a narrow sidebar
    And I load rich message history
    Then user messages use the Lody bubble and upper attachment layout
    And the reply uses the Lody content rail
    When I expand the long user message
    Then the complete user prompt is visible
    When I expand the completed tool work
    Then tool details use a single aligned sheet
    And the page passes accessibility checks
    When I wrap the reply code
    Then code wraps without widening the transcript
    When I preview the Markdown fence
    Then the Markdown fence renders its preview
    When I choose run model "6 Luna" using search "luna"
    When I inspect the accepted turn configuration
    Then the turn configuration is recorded independently of the draft
    And the page passes accessibility checks

  @journey:message-copy @transition:answer>copied @state:history @state:keyboard @state:security
  Scenario: Message and code copy actions retain original text and reset feedback
    Given I open the workspace
    When I load rich message history
    And I copy the reply and its code
    Then copy feedback resets without changing the transcript
