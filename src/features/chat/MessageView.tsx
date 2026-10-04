import type { ComponentProps } from 'react';

import { MessageSurface } from '../../shared/ui/MessageSurface';

export type ChatMessage = ComponentProps<typeof MessageSurface> & { id: string };

export function MessageView({ message }: { message: ChatMessage }) {
  return <MessageSurface {...message} />;
}
