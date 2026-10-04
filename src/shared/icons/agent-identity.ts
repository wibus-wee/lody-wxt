import * as v from 'valibot';

import {
  isAgentBrandId,
  resolveAgentBrandId,
} from '../../../vendor/lody/packages/shared/src/agent-brand';
import { iconMarkup } from './generated';

export interface AgentIdentity {
  cliType?: string | undefined;
  agentType?: string | undefined;
  brandId?: string | undefined;
}

export function agentIdentity(agent: {
  cliType: string;
  agentType: string;
  brandId?: unknown;
  env?: unknown;
}): AgentIdentity {
  const env = v.safeParse(v.object({ ANTHROPIC_BASE_URL: v.optional(v.string()) }), agent.env);
  const baseUrl = env.success ? env.output.ANTHROPIC_BASE_URL : undefined;
  const brandId = resolveAgentBrandId({
    brandId: isAgentBrandId(agent.brandId) ? agent.brandId : undefined,
    env: baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : undefined,
  });
  return { cliType: agent.cliType, agentType: agent.agentType, ...(brandId ? { brandId } : {}) };
}

const builtinIcons = {
  codex: 'openai',
  claude: 'anthropic',
  deepseek: 'deepseek',
  bub: 'bub',
  dimcode: 'dimcode',
  grok: 'registry:grok-build',
  pi: 'registry:pi-acp',
} as const;
export function agentGlyph(agent?: AgentIdentity): keyof typeof iconMarkup.outline {
  if (agent?.cliType === 'custom') return 'terminal';
  if (agent?.cliType === 'builtin') {
    if (isAgentBrandId(agent.brandId)) return agent.brandId;
    const builtin = v.safeParse(
      v.picklist(Object.keys(builtinIcons) as (keyof typeof builtinIcons)[]),
      agent.agentType,
    );
    if (builtin.success) return builtinIcons[builtin.output];
  }
  if (agent?.cliType === 'registry' && agent.agentType === 'claude-p') return 'anthropic';
  const registry = `registry:${agent?.agentType ?? ''}`;
  return Object.hasOwn(iconMarkup.outline, registry)
    ? (registry as keyof typeof iconMarkup.outline)
    : 'agent';
}
