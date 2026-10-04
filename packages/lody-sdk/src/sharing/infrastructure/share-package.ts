import * as v from 'valibot';

import type {
  ShareHistoryEntry,
  ShareJson,
  ShareObject,
  SharePackageManifest,
} from '../domain/models.js';
export type {
  ShareAttachment,
  ShareConversation,
  ShareHistoryEntry,
  ShareJson,
  ShareObject,
  SharePackageManifest,
} from '../domain/models.js';
const secretFragment = /#access=v1\.[a-f0-9]{64}/g;
export const SESSION_SHARE_FILE_ATTACHMENTS_ENABLED = false;
export const SHARE_LIMITS = {
  conversations: 32,
  attachments: 512,
  manifestBytes: 1024 * 1024,
  historyBytes: 32 * 1024 * 1024,
  objectBytes: 100 * 1024 * 1024,
  deploymentBytes: 256 * 1024 * 1024,
  jsonDepth: 64,
} as const;
const resourceId = v.pipe(v.string(), v.regex(/^[\w-]{1,128}$/));
export const ShareResourceId = { parse: (value: unknown) => v.parse(resourceId, value) };
const digest = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
const title = v.pipe(
  v.string(),
  v.check((value) => new TextEncoder().encode(value).length <= 1024),
);
const size = v.pipe(v.number(), v.integer(), v.minValue(0));
const objectSchema = v.strictObject({
  id: resourceId,
  mediaType: v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.regex(/^[\w.+-]+\/[\w.+-]+$/)),
  sizeBytes: v.pipe(size, v.maxValue(SHARE_LIMITS.objectBytes)),
  sha256: digest,
  contentEncoding: v.exactOptional(v.literal('zstd')),
  decodedSizeBytes: v.exactOptional(v.pipe(size, v.maxValue(SHARE_LIMITS.historyBytes))),
});
const manifestSchema = v.strictObject({
  formatVersion: v.picklist([1, 2]),
  historyFormatVersion: v.literal(1),
  capturedAt: v.pipe(v.string(), v.isoTimestamp()),
  rootConversationId: resourceId,
  conversations: v.pipe(
    v.array(
      v.strictObject({
        id: resourceId,
        title,
        historyObjectId: resourceId,
        parentConversationId: v.exactOptional(resourceId),
        openedByConversationId: v.exactOptional(resourceId),
        childSessionPlacement: v.exactOptional(v.literal('side-panel')),
      }),
    ),
    v.minLength(1),
    v.maxLength(SHARE_LIMITS.conversations),
  ),
  attachments: v.pipe(
    v.array(
      v.strictObject({
        id: resourceId,
        kind: v.picklist(['image', 'file']),
        fileName: v.pipe(v.string(), v.maxLength(1024)),
        objectId: resourceId,
      }),
    ),
    v.maxLength(SHARE_LIMITS.attachments),
  ),
  objects: v.pipe(
    v.array(objectSchema),
    v.minLength(1),
    v.maxLength(SHARE_LIMITS.conversations + SHARE_LIMITS.attachments),
  ),
});
export const SharePackageManifestSchema = { parse: parseManifest };
export function parseManifest(value: unknown): SharePackageManifest {
  const manifest = v.parse(manifestSchema, value);
  const invalid = () => {
    throw new Error('Invalid share inventory');
  };
  const conversations = new Map(manifest.conversations.map((entry) => [entry.id, entry]));
  const objects = new Map(manifest.objects.map((entry) => [entry.id, entry]));
  const referenced = new Set<string>();
  for (const object of manifest.objects) {
    if (
      object.contentEncoding
        ? manifest.formatVersion !== 2 ||
          object.mediaType !== 'application/json' ||
          object.decodedSizeBytes === undefined
        : object.decodedSizeBytes !== undefined
    )
      invalid();
  }
  if (
    conversations.size !== manifest.conversations.length ||
    objects.size !== manifest.objects.length ||
    !conversations.has(manifest.rootConversationId) ||
    new Set(manifest.attachments.map((entry) => entry.id)).size !== manifest.attachments.length
  )
    invalid();
  if (
    manifest.objects.reduce((total, entry) => total + entry.sizeBytes, 0) >
      SHARE_LIMITS.deploymentBytes ||
    manifest.objects.reduce(
      (total, entry) => total + (entry.decodedSizeBytes ?? entry.sizeBytes),
      0,
    ) > SHARE_LIMITS.deploymentBytes
  )
    invalid();
  // The UI resolves a Tab's owner before following its opener. Validate the
  // combined graph, not just two individually acyclic relation lists.
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const entry = conversations.get(id);
    if (!entry) return false;
    visiting.add(id);
    for (const target of [entry.parentConversationId, entry.openedByConversationId]) {
      if (target && !visit(target)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const entry of manifest.conversations)
    if (!visit(entry.id)) {
      invalid();
      break;
    }
  for (const conversation of manifest.conversations) {
    const object = objects.get(conversation.historyObjectId);
    if (
      !object ||
      object.mediaType !== 'application/json' ||
      object.sizeBytes > SHARE_LIMITS.historyBytes
    )
      invalid();
    referenced.add(conversation.historyObjectId);
    if (conversation.childSessionPlacement && !conversation.parentConversationId) invalid();
    if (
      conversation.parentConversationId &&
      conversations.get(conversation.parentConversationId)?.parentConversationId
    )
      invalid();
  }
  for (const attachment of manifest.attachments) {
    if (!objects.has(attachment.objectId) || objects.get(attachment.objectId)?.contentEncoding)
      invalid();
    referenced.add(attachment.objectId);
  }
  if (referenced.size !== objects.size) invalid();
  return manifest;
}
export function assertShareAttachmentPolicy(manifest: SharePackageManifest) {
  if (manifest.attachments.some((attachment) => attachment.kind === 'file'))
    throw new Error('share_file_attachments_disabled');
}
const jsonRecord = v.record(v.string(), v.unknown());
// Bound the open JSON wire payload before recursive schemas or display traversal can allocate.
// ast-grep-ignore: no-unknown-parameter
function checkJson(value: unknown, depth = 0, ancestors = new Set<object>()): boolean {
  if (depth > SHARE_LIMITS.jsonDepth) return false;
  if (v.is(v.union([v.null(), v.string(), v.boolean(), v.pipe(v.number(), v.finite())]), value))
    return true;
  if (!Array.isArray(value) && !v.is(jsonRecord, value)) return false;
  if (ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  const valid = Object.values(value).every((child) => checkJson(child, depth + 1, ancestors));
  ancestors.delete(value);
  return valid;
}
const jsonSchema = v.custom<ShareJson>(
  (value) => checkJson(value),
  'Invalid or excessive share JSON',
);
function validateHistoryShape(value: unknown): ShareHistoryEntry[] {
  v.parse(jsonSchema, value);
  const history = v.parse(
    v.array(
      v.looseObject({
        id: v.pipe(v.string(), v.minLength(1)),
        role: v.string(),
        items: v.exactOptional(v.array(v.looseObject({ type: v.string() }))),
      }),
    ),
    value,
  );
  if (new Set(history.map((entry) => entry.id)).size !== history.length)
    throw new Error('Invalid share history');
  return history as ShareHistoryEntry[];
}

/** Only display containers are traversed; opaque tool payloads are reference data. */
// Preserve unknown persisted message variants after the bounded JSON decoder.
function projectShareHistory(
  // ast-grep-ignore: no-unknown-parameter
  value: unknown,
  omitProposals: boolean,
  restoreTitles = true,
): ShareHistoryEntry[] {
  const history = validateHistoryShape(value);
  const blocks = (items: ShareJson[]): ShareJson[] =>
    items.flatMap<ShareJson>((item) => {
      if (!item || !v.is(v.record(v.string(), v.unknown()), item) || Array.isArray(item))
        return [item];
      if (item.type === 'system_notice' && item.name === 'task_proposal') {
        if (!omitProposals) throw new Error('Task proposals are not allowed in share history');
        return [];
      }
      const result = { ...item };
      if (omitProposals) {
        // Shares retain terminal commands, not live handles or output logs.
        if (new Set(['terminal', 'terminal_output']).has(String(item.type))) return [];
        if (item.type === 'tool_call') delete result.permissionRequest;
      }
      for (const key of ['items', 'content', 'inputBlocks']) {
        if (Array.isArray(item[key])) result[key] = blocks(item[key]);
      }
      if (item.type === 'tool_call' && Array.isArray(result.content)) {
        const command = result.content.find(
          (block) =>
            block &&
            v.is(v.record(v.string(), v.unknown()), block) &&
            !Array.isArray(block) &&
            block.type === 'terminal_command',
        );
        if (
          command &&
          v.is(v.record(v.string(), v.unknown()), command) &&
          !Array.isArray(command) &&
          v.is(v.string(), command.command)
        ) {
          // The first command is the unambiguous fallback for an omitted title.
          // Do not trim, normalize, or deduplicate against later commands.
          if (omitProposals && result.title === command.command) delete result.title;
          else if (!omitProposals && restoreTitles && result.title === undefined)
            result.title = command.command;
        }
      }
      return [result];
    });
  return history.map((entry) => {
    const result = { ...entry };
    if (omitProposals) {
      for (const key of ['read', 'userId', 'acpTurnId', 'userTurnId', 'fileDiff'])
        delete result[key];
      // Sending/resuming/Role configuration is not conversation content. Keep
      // input blocks for older histories whose attachments live only here.
      delete result.inputConfig;
    }
    if (Array.isArray(entry.items)) result.items = blocks(entry.items) as typeof entry.items;
    const config = entry.inputConfig;
    // Older user turns stored their display text only in inputConfig.prompt.
    // Materialize that text before dropping execution configuration from a share.
    if (
      omitProposals &&
      entry.role === 'user' &&
      config &&
      v.is(jsonRecord, config) &&
      v.is(v.string(), config.prompt) &&
      config.prompt.length > 0 &&
      !result.items?.some(
        (item) => item.type === 'text' && v.is(v.string(), item.text) && item.text.length > 0,
      )
    ) {
      result.items = [{ type: 'text', text: config.prompt }, ...(result.items ?? [])];
    }
    if (
      config &&
      v.is(v.record(v.string(), v.unknown()), config) &&
      !Array.isArray(config) &&
      Array.isArray(config.inputBlocks)
    ) {
      result.inputConfig = {
        ...(omitProposals ? {} : config),
        inputBlocks: blocks(config.inputBlocks),
      };
    }
    return result;
  });
}

/** Capture projects sharing content before attachments; never edits persisted history. */
// Preserve unknown persisted message variants after the bounded JSON decoder.
// ast-grep-ignore: no-unknown-parameter
export function captureShareHistory(value: unknown): ShareHistoryEntry[] {
  const projected = projectShareHistory(value, true);
  // Known capability syntax only, including credentials repeated in opaque tool
  // output. This transforms the detached export, never the live conversation.
  return JSON.parse(
    JSON.stringify(projected).replace(secretFragment, '#access=omitted'),
  ) as ShareHistoryEntry[];
}

/** Readers reject task proposals rather than mounting workspace task actions. */
// Preserve unknown persisted message variants after the bounded JSON decoder.
export function validateShareHistory(
  // ast-grep-ignore: no-unknown-parameter
  value: unknown,
  options: { restoreTitles?: boolean } = {},
): ShareHistoryEntry[] {
  return projectShareHistory(value, false, options.restoreTitles ?? true);
}

export function encodeShareJson(value: unknown, limit: number): Uint8Array {
  v.parse(jsonSchema, value);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > limit) throw new Error('Share object exceeds size limit');
  return bytes;
}

export async function shareObjectDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyShareObject(bytes: Uint8Array, descriptor: ShareObject): Promise<void> {
  if (
    bytes.byteLength !== descriptor.sizeBytes ||
    (await shareObjectDigest(bytes)) !== descriptor.sha256
  ) {
    throw new Error('Invalid share object');
  }
}
