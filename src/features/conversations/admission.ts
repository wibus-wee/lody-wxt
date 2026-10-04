import type { SendTurn, SessionMetadata, SessionRuntime } from '@lody-mobile/sdk';
import * as v from 'valibot';

const id = v.pipe(v.string(), v.minLength(1));
export const blockSchema = v.variant('type', [
  v.object({ type: v.literal('text'), text: v.string() }),
  v.object({
    type: v.literal('image'),
    imageId: id,
    mimeType: v.picklist(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    fileName: v.exactOptional(v.string()),
    sizeBytes: v.number(),
    width: v.exactOptional(v.number()),
    height: v.exactOptional(v.number()),
    storageSessionId: v.exactOptional(id),
  }),
  v.object({
    type: v.literal('file'),
    fileId: id,
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    textPreview: v.boolean(),
    transport: v.literal('r2'),
    uploadedAt: v.number(),
    storageSessionId: v.exactOptional(id),
  }),
]);
export const turnSchema = v.object({
  requestId: id,
  timestamp: id,
  userId: id,
  inputConfig: v.object({
    prompt: v.string(),
    cliType: v.picklist(['builtin', 'registry', 'custom']),
    agentType: id,
    modelId: v.exactOptional(id),
    modeId: v.exactOptional(id),
    inputBlocks: v.exactOptional(v.array(blockSchema)),
    mcpServerIds: v.exactOptional(v.array(v.pipe(v.string(), v.minLength(1)))),
    configOptionValues: v.exactOptional(v.record(v.string(), v.union([v.string(), v.boolean()]))),
  }),
});
const identitySchema = v.object({ scope: id, workspaceId: id, userId: id });
const metaSchema = v.object({
  id,
  machineId: id,
  userId: id,
  createdAt: id,
  isArchived: v.boolean(),
  title: v.string(),
  agentConfigId: id,
  project: v.exactOptional(v.object({ kind: v.literal('local'), localProjectId: id })),
});
const admissionSchema = v.object({
  identity: identitySchema,
  meta: metaSchema,
  input: turnSchema,
});
export type Admission = v.InferOutput<typeof admissionSchema>;
const newDraftSchema = v.object({
  sessionId: id,
  createdAt: id,
  machineId: v.string(),
  agentId: v.string(),
  projectId: v.string(),
  modelId: v.string(),
  title: v.string(),
  prompt: v.string(),
  attachmentOrigin: v.string(),
  blocks: v.pipe(
    v.array(blockSchema),
    v.check(
      (blocks) =>
        blocks.filter((block) => block.type === 'image').length <= 8 &&
        blocks.filter((block) => block.type === 'file').length <= 8,
    ),
  ),
  pending: v.nullable(admissionSchema),
});
export type NewDraft = v.InferOutput<typeof newDraftSchema>;
export class AdmissionStorage {
  private readonly key: string;
  constructor(scope: string) {
    this.key = `lody:new-draft:${scope}`;
  }
  load(): { draft: NewDraft; error: string | null } {
    const empty: NewDraft = {
      sessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      machineId: '',
      agentId: '',
      projectId: '',
      modelId: '',
      title: '',
      prompt: '',
      attachmentOrigin: '',
      blocks: [],
      pending: null,
    };
    try {
      const raw = localStorage.getItem(this.key);
      if (raw === null) return { draft: empty, error: null };
      const result = v.safeParse(newDraftSchema, JSON.parse(raw));
      if (result.success) return { draft: result.output, error: null };
    } catch {
      /* The corrupt record remains available for recovery. */
    }
    return {
      draft: empty,
      error: 'Saved conversation data could not be read. Sending is paused to protect it.',
    };
  }
  save(draft: NewDraft) {
    const stored = this.load();
    if (stored.error) throw new Error(stored.error);
    if (
      stored.draft.pending &&
      stored.draft.pending.input.requestId !== draft.pending?.input.requestId
    )
      throw new Error('Another surface has a pending admission.');
    localStorage.setItem(this.key, JSON.stringify(v.parse(newDraftSchema, draft)));
  }
  claim(draft: NewDraft): Promise<boolean> {
    return navigator.locks.request(this.key, () => {
      const stored = this.load();
      if (stored.error) throw new Error(stored.error);
      if (stored.draft.pending) return false;
      this.save(draft);
      return true;
    });
  }
  clear(requestId: string) {
    return navigator.locks.request(this.key, () => {
      const stored = this.load();
      if (stored.error) throw new Error(stored.error);
      if (stored.draft.pending?.input.requestId === requestId) localStorage.removeItem(this.key);
    });
  }
}

export async function resumeAdmission(
  runtime: SessionRuntime,
  admission: Admission,
  identity: Admission['identity'],
  signal: AbortSignal,
): Promise<boolean> {
  if (
    admission.identity.scope !== identity.scope ||
    admission.identity.workspaceId !== identity.workspaceId ||
    admission.identity.userId !== identity.userId
  )
    throw new Error('Admission identity mismatch.');
  signal.throwIfAborted();
  const handle = await runtime.openSession(admission.meta.id);
  try {
    signal.throwIfAborted();
    await handle.flush();
    signal.throwIfAborted();
    const snapshot = handle.read();
    const turn = snapshot.history.find((row) => row.id === admission.input.requestId);
    const metadata = (await runtime.listSessions()).find((row) => row.id === admission.meta.id);
    signal.throwIfAborted();
    return Boolean(
      turn &&
      turn.userId === admission.input.userId &&
      turn.timestamp === admission.input.timestamp &&
      metadata?.latestUserMsgId === admission.input.requestId,
    );
  } finally {
    await handle.close();
  }
}

export function admissionInput(
  meta: SessionMetadata,
  input: SendTurn,
  identity: Admission['identity'],
): Admission {
  return v.parse(admissionSchema, { meta, input, identity });
}
