import type { PageContext } from '../page-context/model';
import { githubRepository } from '../page-context/model';
import type { ExecutionTarget } from './client';

// This directory is synthetic and never claims to describe the user's machine.
export const demoTarget: ExecutionTarget = {
  workspaceId: 'demo-workspace',
  machineId: 'demo-machine',
  agentConfigId: 'demo-agent',
  project: { kind: 'chat' },
};
const repositories = ['LodyAI/lody'];
export function matchDemoProject(contexts: PageContext[]): ExecutionTarget['project'] {
  for (const context of contexts) {
    const repo = githubRepository(context.url);
    const configured = repositories.find((item) => item.toLowerCase() === repo?.toLowerCase());
    if (configured) return { kind: 'github', repo: configured };
  }
  return { kind: 'chat' };
}
