import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import type { DemoRequest } from '../chat/demo-runtime';
import { DemoRuntime } from '../chat/demo-runtime';
import type { Conversation, LodyClient } from './client';
import { demoPermissionModes, demoRunModels } from './run-config';

const webRuntime = new DemoRuntime();
async function request(command: DemoRequest) {
  if (!isExtension()) return webRuntime.request(command);
  const result = (await browser.runtime.sendMessage(command)) as {
    data?: Conversation[] | Conversation;
    error?: string;
  };
  if (result.error) throw new Error(result.error);
  return result.data;
}

export const demoClient: LodyClient = {
  accountKey: 'demo:workspace',
  capabilities: { cancel: true, approvals: false, pageActions: false },
  runModels: demoRunModels,
  permissionModes: demoPermissionModes,
  list: async () => (await request({ type: 'lody:demo', action: 'list' })) as Conversation[],
  create: async (target) =>
    (await request({ type: 'lody:demo', action: 'create', target })) as Conversation,
  send: async (input) => {
    await request({ type: 'lody:demo', action: 'send', input });
  },
  stop: async (sessionId) => {
    await request({ type: 'lody:demo', action: 'stop', sessionId });
  },
};
