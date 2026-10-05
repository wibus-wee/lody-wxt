import { useState } from 'react';

import { Alert, Button, Textarea } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { LodyClient, Message, RunConfig } from '../connection/client';
import {
  forkConversation,
  messageAttachments,
  resolveResendConfiguration,
} from './conversation-actions';
import { MessageActions } from './MessageActions';

export function ConversationTurnActions({
  client,
  sessionId,
  message,
  precedingUser,
  currentConfig,
  disabled,
  canFork,
  onOpen,
}: {
  client: LodyClient;
  sessionId: string;
  message: Message;
  precedingUser?: Message | undefined;
  currentConfig?: RunConfig | undefined;
  disabled: boolean;
  canFork: boolean;
  onOpen: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resend = async (source: Message, prompt: string) => {
    const { config } = resolveResendConfiguration(source.inputConfig, currentConfig);
    await client.edit(
      {
        sessionId,
        operationId: crypto.randomUUID(),
        text: prompt,
        contexts: source.contexts,
        attachments: messageAttachments(source),
        ...(config ? { inputConfig: config } : {}),
      },
      source.id,
    );
  };
  const finished = message.role === 'agent' && message.turn.finished === true;
  return (
    <>
      <MessageActions
        disabled={disabled || busy}
        onEdit={
          message.role === 'user'
            ? () => {
                setText(message.text);
                setError('');
                setEditing(true);
              }
            : undefined
        }
        onRegenerate={
          finished && precedingUser ? () => resend(precedingUser, precedingUser.text) : undefined
        }
        onFork={
          finished && canFork
            ? async () => {
                onOpen(await forkConversation(client, sessionId, message.id));
              }
            : undefined
        }
      />
      <Dialog.Root
        open={editing}
        onOpenChange={(open) => {
          if (!busy) setEditing(open);
        }}
      >
        <Dialog.Content>
          <Dialog.Title>编辑并重发</Dialog.Title>
          <Dialog.Description>
            替换这条消息并重新生成，后续对话可能改变。原来的网页资料和附件会一起保留。
            {resolveResendConfiguration(message.inputConfig, currentConfig).usesCurrent &&
              '这条历史消息未保存运行配置，将使用当前选择。'}
          </Dialog.Description>
          <Textarea
            aria-label="修改消息"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            resize="none"
          />
          {error && (
            <Alert.Root tone="danger">
              <Alert.Description>{error}</Alert.Description>
            </Alert.Root>
          )}
          <Dialog.Footer>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button
              disabled={busy || !text.trim()}
              onClick={() => {
                setBusy(true);
                setError('');
                void resend(message, text)
                  .then(() => setEditing(false))
                  .catch((reason: unknown) =>
                    setError(reason instanceof Error ? reason.message : String(reason)),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              重发
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
