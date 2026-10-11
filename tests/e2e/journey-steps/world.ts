import assert from 'node:assert/strict';
import process from 'node:process';

import {
  After,
  Before,
  Given,
  setDefaultTimeout,
  setWorldConstructor,
  World,
} from '@cucumber/cucumber';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium, expect } from '@playwright/test';

import { JourneyEvidence } from '../../../tools/assurance/evidence';
import { AccountBoundary, signIn } from '../support/account-boundary';
import { RuntimeBoundary } from '../support/runtime-boundary';

export class JourneyWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  account = new AccountBoundary();
  cloud = new RuntimeBoundary({ modeOption: 'modeId' });
  evidence!: JourneyEvidence;
  sessionId = '';
  requestId = '';
  originalDelivery: ReturnType<RuntimeBoundary['submittedTurn']> | null = null;
  draft = 'A question to carry across lifecycle boundaries';
  otherPage: Page | null = null;
  assertions: (() => Promise<void>) | undefined;
}
setWorldConstructor(JourneyWorld);
setDefaultTimeout(60_000);

Before(async function (this: JourneyWorld, { pickle }) {
  const tag = (prefix: string) =>
    pickle.tags.find((item) => item.name.startsWith(prefix))?.name.slice(prefix.length);
  this.evidence = new JourneyEvidence(tag('@journey:')!, tag('@case:')!, 'web');
  this.browser = await chromium.launch();
  this.context = await this.browser.newContext({
    viewport: { width: 360, height: 780 },
    hasTouch: tag('@case:') === 'upstream-navigation',
    reducedMotion: 'reduce',
  });
  await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  this.page = await this.context.newPage();
});
After(async function (this: JourneyWorld, { result }) {
  const directory = process.env.ASSURANCE_RUN_DIRECTORY ?? 'reports';
  const trace = `${directory}/${this.evidence.journey}-${this.evidence.variant}-${process.env.ASSURANCE_REPETITION ?? '1'}.trace.zip`;
  if (result?.status === 'FAILED') await this.attach(await this.page.screenshot(), 'image/png');
  await this.context.tracing.stop({ path: trace });
  await this.evidence.write(
    result?.status === 'PASSED' ? 'passed' : result?.status === 'FAILED' ? 'failed' : 'incomplete',
    trace,
  );
  await this.context.close();
  await this.browser.close();
});
Given(
  'an isolated product with real HTTP and Streams protocol boundaries',
  async function (this: JourneyWorld) {
    await this.account.install(this.context);
    await this.cloud.install(this.context);
    await this.page.goto('http://127.0.0.1:4173');
  },
);

export async function ready(world: JourneyWorld) {
  await signIn(world.page);
  await world.page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(world.page.getByRole('button', { name: '运行配置', exact: true })).toContainText(
    'Controlled model',
  );
}
export async function selectFixtureConversation(page: Page) {
  // Match workspaceScope and useLodyClient's accountKey for the isolated account fixture.
  const scope = JSON.stringify(['https://backend.lody.ai', 'lody-cli', 'user-a', 'workspace-a']);
  const accountKey = JSON.stringify([scope, 'https://convex.lody.ai']);
  await page.evaluate((key) => {
    sessionStorage.setItem(`lody:chat-selection:${key}`, 'history-a');
  }, accountKey);
  await page.reload();
  await restored(page);
}
export async function restored(page: Page) {
  await expect(page.getByRole('button', { name: '运行配置', exact: true })).toContainText(
    'Controlled model',
  );
}
export function submittedSession(world: JourneyWorld) {
  const sessions = [
    ...new Set(
      world.cloud.traffic
        .filter((entry) => entry.stream.startsWith('workspace-a:s:'))
        .map((entry) => entry.stream.slice('workspace-a:s:'.length)),
    ),
  ];
  const session = sessions.find((id) =>
    JSON.stringify(world.cloud.document(id).getList('history').toJSON()).includes(world.draft),
  );
  assert.ok(session, 'Remote session contains the authored question');
  return session;
}
