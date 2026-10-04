import type { AgentIdentity } from '../icons/agent-identity';
import { agentGlyph } from '../icons/agent-identity';
import { Icon } from '../icons/Icon';

export function AgentIcon({
  agent,
  size = 16,
}: {
  agent?: AgentIdentity | undefined;
  size?: number;
}) {
  return <Icon name={agentGlyph(agent)} size={size} />;
}
