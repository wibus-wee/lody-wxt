# Verification design and evidence review

Reference: Innei, [我的 AI Native iOS 开发验证工作流](https://innei.in/posts/tech/ai-native-ios-e2e-verification), read 2026-10-10.

The useful distinction is between evidence that a person must interpret and outcomes a machine can decide.
The article's later workflow uses real application automation, stable accessibility identifiers, client/server data differences and concise PASS/FAIL feedback.
Human attention is reserved for product decisions and perceptual behavior such as animation.
This repository retains its existing browser/extension architecture and applies that distinction to independent admission.

| Article mechanism                             | Repository implementation                                                                                    | Acceptance limit                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| UI catalog for isolated interface exploration | Existing Storybook and Lody UI library                                                                       | Supports visual/state exploration; cannot certify persistence, delivery or lifecycle behavior                   |
| XCUITest through actual installed application | Existing Cucumber/Playwright mounted web and packaged Chromium extension journeys                            | Browser infrastructure tests and tooling tests do not replace these journeys                                    |
| Stable accessibility assertions               | Existing Playwright role/name locators, axe and model-derived checkpoints                                    | A visible button alone cannot prove remote admission or restored durable history                                |
| Client/server data difference                 | Assertions at actual protocol fixtures, CRDT history, persistence, permission and installed-asset boundaries | Fixtures control external protocols; they cannot return fabricated successful client outcomes                   |
| PASS/FAIL plus at most three errors           | `review-packet.mjs`, emitted by trusted acceptance from the verified audit and independent decision          | A packet is diagnostic, never merge authority; full raw reports retain authoritative assertion differences      |
| Shortest route into a scenario                | Real product routes and existing deterministic protocol fixtures                                             | Routes must not bypass ownership/lifecycle transitions under test                                               |
| Separate visual and functional judgment       | UI captures plus independent adequacy/probes and executable outcomes                                         | Screenshot compliance alone cannot authorize a behavior change                                                  |
| Controlled worker/resource pool               | Single-worker browser configuration, exclusive preview port and isolated temporary probe checkout            | The local probe helper is not a hostile-code sandbox; independent execution needs externally deployed isolation |

Two article practices intentionally differ here.
Failed attempts are retained in unique assurance run directories rather than overwritten on retry, because the admission contract forbids retry-to-green.
UI changes retain exact-SHA inline PR screenshots even when behavior assertions are strong, because the explicit PR evidence contract requires them.
CI artifact retention and bounded manifests constrain storage; old local runs require deliberate cleanup rather than silent evidence deletion.

No design mock or Artboard is treated as a candidate screenshot.
Upfront product/design discussion can reduce rework, but it does not replace proof from the actual built candidate.
Motion and system Reduce Motion remain product contracts.
New tests must derive their state/lifecycle obligations from `tools/assurance/model.mjs`; this change introduces no rival scenario denominator or component unit-test system.
