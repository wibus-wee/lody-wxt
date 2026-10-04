import * as v from 'valibot';

import type { ScheduleDocument, ScheduleRegistryRow } from '../domain/models.js';
import { definitionSchema, registrySchema, validateTrigger } from './schemas.js';

// The upstream fingerprint canonicalizes heterogeneous JSON protocol values recursively.
// ast-grep-ignore: no-unknown-parameter
export function canonicalScheduleJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalScheduleJson).join(',')}]`;
  // Canonical JSON distinguishes arrays, records, and scalar protocol values.
  // ast-grep-ignore: no-typeof-operator
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalScheduleJson(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function scheduleDefinitionFingerprint(
  document: Pick<ScheduleDocument, 'definition' | 'prompt'>,
) {
  const definition = v.parse(definitionSchema, document.definition);
  validateTrigger(definition.trigger);
  if (!document.prompt.trim() || new TextEncoder().encode(document.prompt).length > 32768)
    throw new Error('Schedule prompt must contain text and be at most 32 KiB');
  const {
    title: _title,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    ...execution
  } = definition;
  const bytes = new TextEncoder().encode(
    canonicalScheduleJson({ definition: execution, prompt: document.prompt }),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function buildScheduleRegistryRow(
  document: ScheduleDocument,
): Promise<ScheduleRegistryRow> {
  const d = document.definition;
  const warningModes = new Set([
    'agent-full-access',
    'danger-full-access',
    'dontAsk',
    'bypassPermissions',
    'yolo',
    'always-approve',
  ]);
  return v.parse(registrySchema, {
    scheduleId: d.scheduleId,
    title: d.title,
    ownerId: d.ownerId,
    machineId: d.machineId,
    enabled: d.enabled,
    activationId: d.activationId,
    activeFrom: d.activeFrom,
    trigger: d.trigger,
    destination: d.destination,
    agentConfigId: d.agent.agentConfigId,
    ...(d.project
      ? {
          projectKind: d.project.kind,
          projectKey:
            d.project.kind === 'local' ? d.project.localProjectId : d.project.repoFullName,
        }
      : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    elevatedPermissions: [d.agent.modeId, ...Object.values(d.agent.configOptionValues ?? {})].some(
      (value) => value !== undefined && warningModes.has(value),
    ),
    definitionFingerprint: await scheduleDefinitionFingerprint(document),
  });
}
