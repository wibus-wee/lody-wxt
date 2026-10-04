import { AttachmentService, HttpAttachmentGateway } from '@lody-mobile/sdk';
import { useEffect, useRef, useState } from 'react';
import * as v from 'valibot';

import { productConfig } from '../../app/product-config';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Dialog } from '../../shared/ui/dialog';
import { Input } from '../../shared/ui/input';
import { Textarea } from '../../shared/ui/textarea';
import { capturePageContext } from '../page-context/capture';
import type { NewDraft } from './admission';
import { admissionInput, AdmissionStorage, blockSchema, resumeAdmission } from './admission';
import { removeAttachment } from './attachment-actions';
import { AttachmentChip } from './AttachmentChip';
import { ChoiceField } from './ChoiceField';
import type { connectConversationWorkspace } from './connect-runtime';
import { refreshMachineCapabilities, startSession } from './session-flows';

type Connection = Awaited<ReturnType<typeof connectConversationWorkspace>>;
type MachineHandle = Awaited<ReturnType<Connection['machines']['open']>>;

export function NewSessionSheet({
  connection,
  workspaceId,
  userId,
  token,
  scope,
  onCreated,
  onClose,
}: {
  connection: Connection;
  workspaceId: string;
  userId: string;
  token: string;
  scope: string;
  onCreated: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [storage] = useState(() => new AdmissionStorage(scope));
  const [restored] = useState(() => storage.load());
  const [draft, setDraft] = useState(restored.draft);
  const draftRef = useRef(draft);
  const [lifecycle] = useState(() => new AbortController());
  useEffect(() => () => lifecycle.abort(), [lifecycle]);
  const { prompt, machineId, agentId, projectId, modelId, title, blocks, sessionId, createdAt } =
    draft;
  const [error, setError] = useState<string | null>(restored.error);
  const change = (patch: Partial<NewDraft>) => {
    if (lifecycle.signal.aborted || draftRef.current.pending || restored.error) return;
    const next = { ...draftRef.current, ...patch };
    try {
      storage.save(next);
      draftRef.current = next;
      setDraft(next);
    } catch {
      setError('Your draft could not be saved. Sending is paused.');
    }
  };
  const setMachineId = (value: string) => change({ machineId: value });
  const setAgentId = (value: string) => change({ agentId: value });
  const setProjectId = (value: string) => change({ projectId: value });
  const setModelId = (value: string) => change({ modelId: value });
  const setTitle = (value: string) => change({ title: value });
  const attachmentConfig = v.safeParse(
    v.object({ attachmentOrigin: v.pipe(v.string(), v.url()) }),
    productConfig,
  );
  const attachmentOrigin = attachmentConfig.success ? attachmentConfig.output.attachmentOrigin : '';
  const [machines, setMachines] = useState<string[]>([]);
  const [visibleProjects, setVisibleProjects] = useState<
    Array<{ machineId: string; localProjectId: string }>
  >([]);
  const [handle, setHandle] = useState<MachineHandle | null>(null);
  const [machine, setMachine] = useState<ReturnType<MachineHandle['read']> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      connection.directory.listMachines(workspaceId),
      connection.directory.listLocalProjects(workspaceId),
    ])
      .then(([rows, projects]) => {
        if (active) {
          setMachines(rows.map((row) => row.machineId));
          setVisibleProjects(projects);
        }
      })
      .catch(() => {
        if (active) setError('Machines could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [connection, workspaceId]);
  useEffect(() => {
    if (!machineId) return;
    let active = true;
    let opened: MachineHandle | null = null;
    let unsubscribe: (() => void) | null = null;
    void connection.machines
      .open(machineId)
      .then(async (next) => {
        if (!active) {
          await next.close();
          return;
        }
        opened = next;
        setHandle(next);
        setMachine(next.read());
        unsubscribe = next.subscribe((snapshot) => {
          if (active) setMachine(snapshot);
        });
      })
      .catch(() => {
        if (active) setError('Machine configuration could not be loaded.');
      });
    return () => {
      active = false;
      unsubscribe?.();
      void opened?.close();
    };
  }, [connection, machineId]);
  const agent = machine?.agents.find((row) => row.id === agentId);
  const capabilities = machine?.capabilities[agentId];
  const updatePrompt = (next: string) => change({ prompt: next });
  const upload = (file: File) => {
    if (busy || draftRef.current.pending || restored.error || lifecycle.signal.aborted) return;
    const image = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).has(file.type);
    if (blocks.filter((block) => block.type === (image ? 'image' : 'file')).length >= 8) {
      setError('You can attach up to eight images and eight files.');
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        lifecycle.signal.throwIfAborted();
        await connection.runtime.createSession({
          id: sessionId,
          machineId,
          userId,
          createdAt,
          isArchived: false,
          title: title || 'New conversation',
        });
        lifecycle.signal.throwIfAborted();
        const service = new AttachmentService(
          new HttpAttachmentGateway({
            origin: attachmentOrigin,
            auth: { getToken: async () => token },
          }),
        );
        const uploaded = image
          ? await service.uploadImages(
              { workspaceId, sessionId, images: [{ blob: file, fileName: file.name }] },
              { signal: lifecycle.signal },
            )
          : [
              await service.uploadFile(
                { workspaceId, sessionId, blob: file, fileName: file.name, textPreview: true },
                { signal: lifecycle.signal },
              ),
            ];
        lifecycle.signal.throwIfAborted();
        change({
          blocks: [
            ...draftRef.current.blocks,
            ...uploaded.map((block) => v.parse(blockSchema, block)),
          ],
        });
      } catch {
        if (!lifecycle.signal.aborted) setError('Attachment upload failed. Your draft is saved.');
      } finally {
        if (!lifecycle.signal.aborted) setBusy(false);
      }
    })();
  };
  const send = () => {
    if (
      !agent ||
      !machineId ||
      !prompt.trim() ||
      busy ||
      draftRef.current.pending ||
      restored.error ||
      lifecycle.signal.aborted
    )
      return;
    const requestId = crypto.randomUUID();
    const input = {
      requestId,
      timestamp: new Date().toISOString(),
      userId,
      inputConfig: {
        prompt,
        cliType: agent.cliType,
        agentType: agent.agentType,
        ...(modelId ? { modelId } : {}),
        ...(blocks.length
          ? { inputBlocks: [{ type: 'text' as const, text: prompt }, ...blocks] }
          : {}),
      },
    };
    const admission = admissionInput(
      {
        id: sessionId,
        machineId,
        userId,
        createdAt,
        isArchived: false,
        title: title || prompt.slice(0, 80),
        agentConfigId: agentId,
        ...(projectId ? { project: { kind: 'local', localProjectId: projectId } } : {}),
      },
      input,
      { scope, workspaceId, userId },
    );
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const next = { ...draftRef.current, pending: admission };
        if (!(await storage.claim(next))) {
          const stored = storage.load();
          draftRef.current = stored.draft;
          setDraft(stored.draft);
          throw new Error('An admission already exists.');
        }
        draftRef.current = next;
        setDraft(next);
        lifecycle.signal.throwIfAborted();
        await startSession(connection.runtime, admission.meta, admission.input);
        lifecycle.signal.throwIfAborted();
        await storage.clear(requestId);
        lifecycle.signal.throwIfAborted();
        onCreated(sessionId);
      } catch {
        if (!lifecycle.signal.aborted)
          setError(`Delivery is unconfirmed. Check request ${requestId} before continuing.`);
      } finally {
        if (!lifecycle.signal.aborted) setBusy(false);
      }
    })();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          lifecycle.abort();
          onClose();
        }
      }}
    >
      <Dialog.Content>
        <Dialog.Title>New conversation</Dialog.Title>
        <Button
          onClick={() => {
            lifecycle.abort();
            onClose();
          }}
        >
          Close
        </Button>
        {error && (
          <Alert.Root role="alert">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        )}
        {draft.pending && (
          <Button
            disabled={busy}
            onClick={() => {
              const pending = draftRef.current.pending;
              if (!pending) return;
              setBusy(true);
              void resumeAdmission(
                connection.runtime,
                pending,
                { scope, workspaceId, userId },
                lifecycle.signal,
              )
                .then(async (confirmed) => {
                  lifecycle.signal.throwIfAborted();
                  if (!confirmed) {
                    setError('Delivery remains unconfirmed. No request was resent.');
                    return;
                  }
                  await storage.clear(pending.input.requestId);
                  lifecycle.signal.throwIfAborted();
                  onCreated(sessionId);
                })
                .catch(() => {
                  if (!lifecycle.signal.aborted) setError('Delivery could not be checked.');
                })
                .finally(() => {
                  if (!lifecycle.signal.aborted) setBusy(false);
                });
            }}
          >
            Check saved request
          </Button>
        )}
        <ChoiceField
          label="Machine"
          value={machineId}
          disabled={busy}
          choices={[
            { value: '', label: 'Select machine' },
            ...machines.map((id) => ({ value: id, label: id })),
          ]}
          onChange={(value) => {
            setMachineId(value);
            setAgentId('');
            setProjectId('');
            setModelId('');
          }}
        />
        <ChoiceField
          label="Agent"
          value={agentId}
          disabled={busy || !machineId}
          choices={[
            { value: '', label: 'Select agent' },
            ...(machine?.agents.map((row) => ({ value: row.id, label: row.name })) ?? []),
          ]}
          onChange={setAgentId}
        />
        <Button
          disabled={!agent || busy || !handle}
          onClick={() =>
            void refreshMachineCapabilities(
              connection.runtime,
              machineId,
              agentId,
              crypto.randomUUID(),
              lifecycle.signal,
            ).catch(() => setError('Model discovery failed.'))
          }
        >
          Refresh models
        </Button>
        <ChoiceField
          label="Project"
          value={projectId}
          disabled={busy || !machineId}
          choices={[
            { value: '', label: 'No project' },
            ...(machine?.projects
              .filter((row) =>
                visibleProjects.some(
                  (project) =>
                    project.machineId === machineId &&
                    project.localProjectId === row.localProjectId,
                ),
              )
              .map((row) => ({ value: row.localProjectId, label: row.localProjectId })) ?? []),
          ]}
          onChange={setProjectId}
        />
        <ChoiceField
          label="Model"
          value={modelId}
          disabled={busy || !agent}
          choices={[
            { value: '', label: 'Agent default' },
            ...(capabilities
              ? capabilities.models.map((row) => ({
                  value: row.modelId,
                  label: row.name,
                }))
              : []),
          ]}
          onChange={setModelId}
        />
        <label htmlFor="new-session-title">
          Title
          <Input
            id="new-session-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label htmlFor="new-session-prompt">
          Prompt
          <Textarea
            id="new-session-prompt"
            value={prompt}
            onChange={(event) => updatePrompt(event.target.value)}
          />
        </label>
        {new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol) && (
          <Button
            disabled={busy}
            onClick={() =>
              void capturePageContext()
                .then((context) =>
                  updatePrompt(
                    `${prompt}\n\nPage: ${context.title}\nURL: ${context.url}\n${context.selection}`,
                  ),
                )
                .catch(() => setError('Page could not be accessed.'))
            }
          >
            Use selected page
          </Button>
        )}
        {!attachmentConfig.success && (
          <Alert.Root>
            <Alert.Description>Attachments are unavailable in this build.</Alert.Description>
          </Alert.Root>
        )}
        <label htmlFor="attachment-file">
          Attach file
          <Input
            id="attachment-file"
            type="file"
            disabled={!machineId || busy || !attachmentOrigin}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
        </label>
        <ul>
          {blocks.map(
            (block) =>
              block.type !== 'text' && (
                <li key={block.type === 'file' ? block.fileId : block.imageId}>
                  <AttachmentChip
                    block={block}
                    workspaceId={workspaceId}
                    sessionId={sessionId}
                    origin={attachmentOrigin}
                    token={token}
                    disabled={busy || draft.pending !== null}
                    onRemove={() =>
                      change({
                        blocks: removeAttachment(
                          blocks,
                          block.type === 'file' ? block.fileId : block.imageId,
                        ),
                      })
                    }
                  />
                </li>
              ),
          )}
        </ul>
        <Button
          disabled={
            !agent || !prompt.trim() || busy || draft.pending !== null || restored.error !== null
          }
          onClick={send}
        >
          Send
        </Button>
      </Dialog.Content>
    </Dialog.Root>
  );
}
