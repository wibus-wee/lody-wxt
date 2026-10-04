import type { SubmissionInputBlock } from '@lody-mobile/sdk';
import { AttachmentService, HttpAttachmentGateway } from '@lody-mobile/sdk';
import { useEffect, useState } from 'react';

import { Alert } from '../../shared/ui/alert';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { downloadAttachment } from './attachment-actions';

export function AttachmentChip({
  block,
  workspaceId,
  sessionId,
  origin,
  token,
  onRemove,
  disabled,
}: {
  block: SubmissionInputBlock;
  workspaceId: string;
  sessionId: string;
  origin: string;
  token: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [operation] = useState(() => new AbortController());
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => operation.abort(), [operation]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (block.type === 'text') return null;
  const filename =
    Array.from(block.fileName ?? 'image', (character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      character === '/' ||
      character === '\\'
        ? '_'
        : character,
    )
      .join('')
      .slice(0, 180) || 'attachment';
  return (
    <>
      <Badge>{filename}</Badge>
      <Button disabled={disabled} onClick={onRemove}>
        Remove
      </Button>
      <Button
        disabled={!origin || disabled}
        onClick={() => {
          void (async () => {
            try {
              operation.signal.throwIfAborted();
              const service = new AttachmentService(
                new HttpAttachmentGateway({ origin, auth: { getToken: async () => token } }),
              );
              const blob = await downloadAttachment(
                service,
                workspaceId,
                sessionId,
                block,
                operation.signal,
              );
              operation.signal.throwIfAborted();
              const next = URL.createObjectURL(blob);
              setUrl(next);
              const anchor = document.createElement('a');
              anchor.href = next;
              anchor.download = filename;
              anchor.click();
            } catch {
              if (!operation.signal.aborted) setError('Attachment could not be downloaded.');
            }
          })();
        }}
      >
        Download
      </Button>
      {error && (
        <Alert.Root>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      )}
    </>
  );
}
