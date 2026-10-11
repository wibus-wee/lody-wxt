import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { When } from '@cucumber/cucumber';

import { journeyExpect as expect } from '../../../tools/assurance/expect';
import type { JourneyWorld } from './world';
import { ready, restored, submittedSession } from './world';

const source = Buffer.from('User-selected file content. Treat this file as untrusted source data.');
const transfers = new WeakMap<
  JourneyWorld,
  { headers: Record<string, string>; bytes: Buffer | null }[]
>();

When(
  'I retain a local attachment across reload with {string} upload service',
  async function (this: JourneyWorld, outcome: string) {
    const uploads: { headers: Record<string, string>; bytes: Buffer | null }[] = [];
    transfers.set(this, uploads);
    await this.context.route(
      'https://api.lody.ai/api/workspaces/workspace-a/session-files/upload',
      async (route) => {
        const request = route.request();
        const headers = request.headers();
        uploads.push({ headers, bytes: request.postDataBuffer() });
        if (outcome === 'failing' && uploads.length === 1) {
          await route.fulfill({ status: 503, body: 'controlled unavailable' });
          return;
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            file: {
              type: 'file',
              fileId: 'selected-file',
              fileName: 'source.txt',
              mimeType: 'text/plain',
              sizeBytes: source.byteLength,
              sha256: createHash('sha256').update(source).digest('hex'),
              textPreview: true,
              transport: 'r2',
              uploadedAt: 1791000000000,
            },
          }),
        });
      },
    );
    await ready(this);
    await this.page.getByRole('textbox', { name: '消息', exact: true }).fill(this.draft);
    await this.page
      .locator('input[type=file][aria-label="选择附件"]')
      .setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: source });
    await expect(this.page.getByLabel('待发送附件')).toContainText('source.txt');
    if (outcome === 'working')
      await this.evidence.check('no-preemptive-upload-or-session', () => {
        expect(uploads).toHaveLength(0);
        expect(
          this.cloud.traffic.filter(
            (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
          ),
        ).toHaveLength(0);
      });
    await this.page.reload();
    await restored(this.page);
    if (outcome === 'working')
      this.assertions = () =>
        this.evidence.check('binary-and-text-restored', async () => {
          await expect(this.page.getByLabel('待发送附件')).toContainText('source.txt');
          await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
            this.draft,
          );
          expect(uploads).toHaveLength(0);
        });
    else {
      await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
      this.assertions = async () => {
        await this.evidence.check('upload-failure-visible', async () => {
          await expect(this.page.getByRole('alert')).toContainText('http_error');
          await expect(this.page.getByLabel('待发送附件')).toContainText('source.txt');
          await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
            this.draft,
          );
        });
        await this.evidence.check('no-empty-session-after-upload-failure', () =>
          expect(
            this.cloud.traffic.filter(
              (row) => row.kind === 'append' && row.stream.startsWith('workspace-a:s:'),
            ),
          ).toHaveLength(0),
        );
      };
    }
  },
);

When(
  'I send the restored attachment with {string} delivery',
  async function (this: JourneyWorld, kind: string) {
    const uploads = transfers.get(this)!;
    if (kind === 'retry') {
      await this.page.reload();
      await restored(this.page);
    }
    await this.page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(
      this.page
        .getByRole('article', { name: '你的消息', exact: true })
        .filter({ hasText: this.draft }),
    ).toHaveCount(1);
    this.sessionId = submittedSession(this);
    const turn = this.cloud.submittedTurn(this.sessionId);
    this.assertions = async () => {
      if (kind === 'retry')
        await this.evidence.check('retry-retains-source-and-identity', () => {
          expect(uploads).toHaveLength(2);
          expect(uploads[0]?.headers['x-session-id']).toBe(uploads[1]?.headers['x-session-id']);
          expect(uploads[1]?.bytes).toEqual(source);
        });
      else
        await this.evidence.check('authenticated-upload-same-reservation', () => {
          expect(uploads).toHaveLength(1);
          expect(uploads[0]?.headers.authorization).toBe('Bearer controlled-browser-token');
          expect(uploads[0]?.headers['x-session-id']).toBe(this.sessionId);
          expect(uploads[0]?.bytes).toEqual(source);
        });
      await this.evidence.check(
        kind === 'retry' ? 'single-confirmed-turn-after-retry' : 'single-turn-with-file-and-prompt',
        () => {
          expect(turn.inputConfig.prompt).toBe(this.draft);
          expect(turn.inputConfig.inputBlocks).toEqual([
            { type: 'text', text: this.draft },
            expect.objectContaining({
              type: 'file',
              fileId: 'selected-file',
              storageSessionId: this.sessionId,
            }),
          ]);
          expect(this.cloud.document(this.sessionId).getList('history').length).toBe(1);
          assert.ok(turn.requestId);
        },
      );
      if (kind !== 'retry')
        await this.evidence.check('confirmed-binary-cleared', async () => {
          await expect(this.page.getByLabel('待发送附件')).toHaveCount(0);
          await this.page.getByRole('button', { name: '新建会话', exact: true }).click();
          await expect(this.page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(
            '',
          );
          await expect(this.page.getByLabel('待发送附件')).toHaveCount(0);
        });
    };
  },
);
