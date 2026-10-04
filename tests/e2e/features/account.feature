@namespace:account
Feature: Account access through the configured HTTP server
  @journey:device-login @state:unconfigured @state:signed-in @transition:configured>authorizing @transition:authorizing>signed-in
  Scenario: Verify a device code and choose a workspace
    Given a controlled account HTTP server
    And device authorization requires verification
    And I open the workspace
    When I configure the account server
    And I request a device login
    Then I see and approve the device code on the verification page
    And the authenticated workspaces can be selected
    When I reload the workspace
    Then the authenticated workspaces can be selected

  @journey:invalid-session @state:error @transition:authorizing>error
  Scenario: Malformed account data never grants conversation access
    Given a controlled account HTTP server
    And the account server returns a malformed session
    And I open the workspace
    When I configure the account server
    And I request a device login
    Then the invalid session remains an account error
