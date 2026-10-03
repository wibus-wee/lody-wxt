import type { PermissionOption } from '../../shared/ui/PermissionModeMenu';

export type { PermissionOption } from '../../shared/ui/PermissionModeMenu';

export interface RunConfig {
  modelId: string;
  reasoningEffort: string;
  planMode: boolean;
  fastMode: boolean;
  modeId?: string | undefined;
}

// Lody shared/src/ai.ts CODEX_STATIC_MODES, used only by the explicit demo client.
export const demoPermissionModes: readonly PermissionOption[] = [
  {
    value: 'read-only',
    label: 'Read-only',
    description: 'Requires approval to edit files and run commands.',
    icon: 'readOnly',
  },
  {
    value: 'agent',
    label: 'Agent',
    description: 'Read and edit files, and run commands.',
    icon: 'permission',
  },
  {
    value: 'agent-auto-review',
    label: 'Auto review',
    description:
      'Read and edit files, and run commands. Approval requests are reviewed automatically by a Codex subagent.',
    icon: 'permission',
  },
  {
    value: 'agent-full-access',
    label: 'Full access',
    description:
      'Codex can edit files outside this workspace and run commands with network access. Exercise caution when using.',
    icon: 'permissionWarning',
    warning: true,
  },
];

export interface RunModel {
  value: string;
  label: string;
  reasoningEfforts: readonly string[];
  planMode: boolean;
  fastMode: boolean;
}

const fullEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const demoRunModels: readonly RunModel[] = [
  {
    value: 'gpt-6.1-sol',
    label: '6.1 Sol',
    reasoningEfforts: fullEfforts,
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-6-astra',
    label: '6 Astra',
    reasoningEfforts: fullEfforts,
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-6-sol',
    label: '6 Sol',
    reasoningEfforts: fullEfforts,
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-6-luna',
    label: '6 Luna',
    reasoningEfforts: fullEfforts.slice(0, 5),
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-5.6-sol',
    label: '5.6 Sol',
    reasoningEfforts: fullEfforts,
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-5.6-terra',
    label: '5.6 Terra',
    reasoningEfforts: fullEfforts,
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-5.6-luna',
    label: '5.6 Luna',
    reasoningEfforts: fullEfforts.slice(0, 5),
    planMode: true,
    fastMode: true,
  },
  {
    value: 'gpt-5.5',
    label: '5.5',
    reasoningEfforts: fullEfforts.slice(0, 4),
    planMode: true,
    fastMode: true,
  },
];

export const reasoningLabel = (value: string) =>
  ({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra' })[
    value
  ] ?? value;

export function normalizeRunConfig(
  models: readonly RunModel[],
  value?: RunConfig,
  modes: readonly PermissionOption[] = [],
): RunConfig | undefined {
  const model = models.find((item) => item.value === value?.modelId) ?? models[0];
  if (!model) return undefined;
  return {
    modelId: model.value,
    reasoningEffort: model.reasoningEfforts.includes(value?.reasoningEffort ?? '')
      ? value!.reasoningEffort
      : model.reasoningEfforts.includes('medium')
        ? 'medium'
        : (model.reasoningEfforts[0] ?? ''),
    planMode: model.planMode && (value?.planMode ?? false),
    fastMode: model.fastMode && (value?.fastMode ?? false),
    ...(value?.modeId !== undefined
      ? { modeId: modes.find((mode) => mode.value === value.modeId && !mode.disabled)?.value }
      : {}),
  };
}

export function parseRunConfig(value: unknown): RunConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const config = value as Record<string, unknown>;
  if (
    typeof config.modelId !== 'string' ||
    !config.modelId ||
    config.modelId.length > 200 ||
    typeof config.reasoningEffort !== 'string' ||
    config.reasoningEffort.length > 100 ||
    typeof config.planMode !== 'boolean' ||
    typeof config.fastMode !== 'boolean' ||
    (config.modeId !== undefined &&
      (typeof config.modeId !== 'string' || !config.modeId || config.modeId.length > 200))
  )
    return undefined;
  return {
    modelId: config.modelId,
    reasoningEffort: config.reasoningEffort,
    planMode: config.planMode,
    fastMode: config.fastMode,
    ...(typeof config.modeId === 'string' ? { modeId: config.modeId } : {}),
  };
}
