# Changelog

## [0.2.3](https://github.com/wibus-wee/lody-wxt/compare/v0.2.2...v0.2.3) (2026-10-12)

### Bug Fixes

- Write release coverage evidence into the uploaded reports directory instead of modifying tracked COVERAGE.md. Source and submodule drift checks remain strict.

The v0.2.2 tag is retained unchanged; its package was built but publication was blocked by generated report drift.

## [0.2.2](https://github.com/wibus-wee/lody-wxt/compare/v0.2.1...v0.2.2) (2026-10-12)

### Bug Fixes

- Report release performance sampling gaps and regressions without blocking package publication; keep functional, installation and provenance checks enforced.
- Wait for the target notification event to be persisted before asserting completion.

The v0.2.0 and v0.2.1 tags are retained unchanged. Neither produced a published package.

## [0.2.1](https://github.com/wibus-wee/lody-wxt/compare/v0.2.0...v0.2.1) (2026-10-12)

### Bug Fixes

- Collect independent packaged-extension performance samples for every release repetition, preserving separate reports and traces ([#14](https://github.com/wibus-wee/lody-wxt/pull/14)).
- Support the approved single-maintainer release flow while retaining release checks and exact-commit promotion ([#13](https://github.com/wibus-wee/lody-wxt/pull/13)).

The v0.2.0 tag is retained unchanged. Its release stopped before publication because packaged-extension performance sampling was incomplete.

## [0.2.0](https://github.com/wibus-wee/lody-wxt/compare/v0.1.0...v0.2.0) (2026-10-12)


### Features

* **account:** add device authorization and background HTTP transport ([5ffd602](https://github.com/wibus-wee/lody-wxt/commit/5ffd602d418c17ddda92a0e7da5a5c1e42ae003e))
* add Chrome release packages and quiet appcast update checks ([#2](https://github.com/wibus-wee/lody-wxt/issues/2)) ([53b7caa](https://github.com/wibus-wee/lody-wxt/commit/53b7caaec7ef5e0d68ede424edb6a29cd2fed7ae))
* add protected autonomous maintenance pipeline ([#4](https://github.com/wibus-wee/lody-wxt/issues/4)) ([7a39a5b](https://github.com/wibus-wee/lody-wxt/commit/7a39a5bdeb67a3ccc1acb499b68002d7167370b2))
* **browser:** add contextual sources, durable attachments, privacy and notifications ([c33aa8d](https://github.com/wibus-wee/lody-wxt/commit/c33aa8d6c80d3b1625c234e0c064864b208ff21a))
* **chat:** connect conversations to real agents and run configuration ([7568b7c](https://github.com/wibus-wee/lody-wxt/commit/7568b7cc21b20abff108cadc2ed6da7db5e5d267))
* **chat:** improve conversation controls and transcript reading ([27a95b6](https://github.com/wibus-wee/lody-wxt/commit/27a95b68f9f42c33e9837500371cd2e4196071b5))
* **chat:** integrate mentions, turn actions, automations and sharing ([5b0d8fc](https://github.com/wibus-wee/lody-wxt/commit/5b0d8fc000e127416a952d0cadf13867e6b479c0))
* **conversations:** add session runtime and durable delivery recovery ([55c3990](https://github.com/wibus-wee/lody-wxt/commit/55c3990b04d018aabfbc7fe2eac16c220654c92c))
* enhance ([c226b93](https://github.com/wibus-wee/lody-wxt/commit/c226b933e945ad2e5730f8b2ee3dccd93b3686e5))
* **extension:** mount side panel chat and verify workspace journeys ([d9710c5](https://github.com/wibus-wee/lody-wxt/commit/d9710c551c08a304594ea1a06a36f2e3d0ac7c46))
* **extension:** share workspace connection through background ([f3e4c24](https://github.com/wibus-wee/lody-wxt/commit/f3e4c244a7517d30bf101b5aec06f60bfb467799))
* implement screenshot overlay feature with cropping capabilities ([9de2772](https://github.com/wibus-wee/lody-wxt/commit/9de2772fa030b9fbe4d79c1f5c70b14b86d62521))
* lazy load routes and optimize workspace bootstrap caching ([4376a7a](https://github.com/wibus-wee/lody-wxt/commit/4376a7a69321797606b9196889907470d3adfc1b))
* **network:** authorize cloud mutations and report structured worker rejections ([72abec0](https://github.com/wibus-wee/lody-wxt/commit/72abec006911ceca892194161283190e881336f5))
* **page-context:** capture pages and selections for side panel chats ([42270eb](https://github.com/wibus-wee/lody-wxt/commit/42270eb0efca1d6b0ccf2f3ed0290cd66f16a405))
* **preferences:** add theme settings and shared durable storage ([f9713c9](https://github.com/wibus-wee/lody-wxt/commit/f9713c973d4f8150004b6d59148f820ebb2d0917))
* scaffold WXT React foundation with Lody UI submodule ([ba06bcd](https://github.com/wibus-wee/lody-wxt/commit/ba06bcd6787cc69aa3213c278d878208de156321))
* scaffold WXT React foundation with Lody UI submodule ([#1](https://github.com/wibus-wee/lody-wxt/issues/1)) ([ba06bcd](https://github.com/wibus-wee/lody-wxt/commit/ba06bcd6787cc69aa3213c278d878208de156321))
* **sdk:** add schedule persistence, recurrence validation and previews ([4b7af53](https://github.com/wibus-wee/lody-wxt/commit/4b7af537b116cbdbd78f0ab73b75a1bd99cc6bef))
* **sdk:** add scoped prompt shortcuts with durable Streams synchronization ([1cc7735](https://github.com/wibus-wee/lody-wxt/commit/1cc77356259ff5b1583fcde424e63216e029ecdf))
* **sdk:** add standalone Lody client and workspace build support ([a1fcee0](https://github.com/wibus-wee/lody-wxt/commit/a1fcee0691dcb32e31169cbdbf2f3ff095d358f8))
* **sdk:** add verifiable static sharing and deployment management ([1fac83d](https://github.com/wibus-wee/lody-wxt/commit/1fac83d0fda3661ecb4fa3d283358f1866645848))
* **sdk:** expose MCP catalogs, skills and conversation command metadata ([f48650f](https://github.com/wibus-wee/lody-wxt/commit/f48650f2cb55b67d31acbc95a6ed3638ac28d447))
* **sdk:** preserve session identity and recovery metadata ([66caa4c](https://github.com/wibus-wee/lody-wxt/commit/66caa4c2146bc638e72ad2f0368000b0ce517903))
* **ui:** add structured conversation rendering and reusable mention surfaces ([a4a1017](https://github.com/wibus-wee/lody-wxt/commit/a4a10173753fc216f67eade01e82f04ef8b15460))
* **ui:** integrate Lody controls, message surfaces and mood icons ([4af8a5b](https://github.com/wibus-wee/lody-wxt/commit/4af8a5bed124013ed3d7831b62c285f668d59353))


### Bug Fixes

* configure official extension and toolbar icons ([#11](https://github.com/wibus-wee/lody-wxt/issues/11)) ([a10ecf4](https://github.com/wibus-wee/lody-wxt/commit/a10ecf4383cebb02619a687eb99f20355a3e7eb0))
* **devframe:** share supported icon mood catalog ([7c6915a](https://github.com/wibus-wee/lody-wxt/commit/7c6915a906f80788991790e69c40c5c748c016ed))
* filter unnamed machines and show presence badges ([#3](https://github.com/wibus-wee/lody-wxt/issues/3)) ([4391fae](https://github.com/wibus-wee/lody-wxt/commit/4391fae7db615aa2ac63331331d3dbf1fe04b1d3))
* handle monitoring before the first stable release ([#10](https://github.com/wibus-wee/lody-wxt/issues/10)) ([51bae2b](https://github.com/wibus-wee/lody-wxt/commit/51bae2bcad68f608a5f9bb2a780765016d85f776))
* repair maintenance workflow initialization and dictation checks ([#8](https://github.com/wibus-wee/lody-wxt/issues/8)) ([11f55f1](https://github.com/wibus-wee/lody-wxt/commit/11f55f1b210a8228fd6b1a725bef5fe947f42448))
* request microphone permission for dictation ([#5](https://github.com/wibus-wee/lody-wxt/issues/5)) ([844c5d9](https://github.com/wibus-wee/lody-wxt/commit/844c5d99b49390083069ca205b384bb2098439e6))
