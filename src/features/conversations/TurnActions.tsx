import type { SessionTurn } from '@lody-mobile/sdk';
import { useState } from 'react';

import { Button } from '../../shared/ui/button';
import { Dialog } from '../../shared/ui/dialog';
import { Textarea } from '../../shared/ui/textarea';
import type { ConversationRuntimeController } from './runtime-controller';

export function TurnActions({
  turn,
  controller,
  userId,
  busy,
}: {
  turn: SessionTurn;
  controller: ConversationRuntimeController;
  userId: string;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(turn.inputConfig?.prompt ?? '');
  const fork = turn.role === 'assistant' && turn.finished === true;
  const edit =
    turn.role === 'user' &&
    turn.userId === userId &&
    turn.inputConfig?.cliType &&
    turn.inputConfig.agentType;
  if (!fork && !edit) return null;
  return (
    <>
      <Button disabled={busy} onClick={() => setOpen(true)}>
        {fork ? 'Fork from this turn' : 'Edit and resend'}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content>
          <Dialog.Title>{fork ? 'Fork conversation' : 'Edit and resend'}</Dialog.Title>
          <Dialog.Description>
            {fork
              ? 'Create a new conversation from this finished turn using the same project context.'
              : 'Replace this exact user turn and request a new response. Later conversation history may change.'}
          </Dialog.Description>
          {edit && (
            <label htmlFor={`edit-${turn.id}`}>
              Replacement message
              <Textarea
                id={`edit-${turn.id}`}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
          )}
          <Dialog.Footer>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || (Boolean(edit) && !prompt.trim())}
              onClick={() => {
                if (fork) void controller.forkTurn(turn.id, userId).then(() => setOpen(false));
                else if (turn.inputConfig?.cliType && turn.inputConfig.agentType)
                  void controller
                    .editTurn(turn.id, {
                      requestId: crypto.randomUUID(),
                      timestamp: new Date().toISOString(),
                      userId,
                      inputConfig: {
                        ...turn.inputConfig,
                        prompt,
                        ...(turn.inputConfig.inputBlocks
                          ? {
                              inputBlocks: [
                                { type: 'text' as const, text: prompt },
                                ...turn.inputConfig.inputBlocks.filter(
                                  (block) => block.type !== 'text',
                                ),
                              ],
                            }
                          : {}),
                        cliType: turn.inputConfig.cliType,
                        agentType: turn.inputConfig.agentType,
                      },
                    })
                    .then(() => setOpen(false));
              }}
            >
              Confirm
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
