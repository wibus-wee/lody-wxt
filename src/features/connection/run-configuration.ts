import type { MachineCapabilities } from '@lody-mobile/sdk/loro';
import * as v from 'valibot';

import {
  getBuiltinModelControlBinding,
  getDeclaredModelControls,
  getModelEffortChoices,
  resolveDeclaredEffortSupport,
} from '../../../vendor/lody/packages/shared/src/acp-model-capabilities';
import type { ClientSnapshot, Conversation, RunConfig } from './client';

type ConfigOption = NonNullable<ClientSnapshot['configOptions']>[number];

/** Mirrors shared/session-input.ts collectSessionConversationSources: queue tail before history. */
export function inheritedMcpSelection(
  conversation: Pick<Conversation, 'messages' | 'queued'> | undefined,
  explicitIds: readonly string[] | undefined,
): string[] | undefined {
  if (explicitIds !== undefined) return [...explicitIds];
  if (!conversation) return undefined;
  const queued = conversation?.queued?.at(-1);
  const source = queued
    ? queued.acpSessionConfig
    : conversation?.messages.findLast((message) => message.role === 'user')?.turn.inputConfig;
  // Existing conversations without a selection must not pick up fresh-session catalog defaults.
  return [...(source?.mcpServerIds ?? [])];
}

// Ported from vendor/lody/packages/shared/src/ai.ts: BUILTIN_DEFAULT_MODE_IDS and
// getBuiltinDefaultModeId. Importing ai.ts also loads upstream adapter dependencies.
const builtinDefaultModeIds = new Map([
  ['kimi', 'auto'],
  ['grok', 'default'],
  ['claude', 'auto'],
  ['codex', 'agent-auto-review'],
  ['deepseek', 'workspace-write'],
]);

/** Upstream resolveConfigOptions prefers the complete option table over legacy arrays. */
export function resolveRunCapabilities(caps: MachineCapabilities) {
  const configOptions: ConfigOption[] = caps.configOptions?.length
    ? [...caps.configOptions]
    : [
        ...(caps.modes.length
          ? [
              {
                id: 'mode',
                category: 'mode',
                name: 'Mode',
                type: 'select' as const,
                currentValue: caps.modes[0]!.id,
                options: caps.modes.map((mode) => ({
                  value: mode.id,
                  name: mode.name,
                  description: mode.description,
                })),
              },
            ]
          : []),
        ...(caps.models.length
          ? [
              {
                id: 'model',
                category: 'model',
                name: 'Model',
                type: 'select' as const,
                currentValue: caps.models[0]!.modelId,
                options: caps.models.map((model) => ({ value: model.modelId, name: model.name })),
              },
            ]
          : []),
      ];
  const modelOption = configOptions.find(
    (option) => option.type === 'select' && configurationCategory(option) === 'model',
  );
  const modeOption = configOptions.find(
    (option) =>
      option.type === 'select' &&
      option.id !== 'interaction_mode' &&
      configurationCategory(option) === 'mode',
  );
  // Registry/custom agents expose their selections solely through configOptionValues upstream.
  const builtin = caps.cliType === 'builtin';
  return {
    configOptions,
    models: builtin
      ? (modelOption?.options ?? []).map((option) => ({
          modelId: v.parse(v.string(), option.value),
          name: option.name,
        }))
      : [],
    modes: builtin
      ? (modeOption?.options ?? []).map((option) => ({
          id: v.parse(v.string(), option.value),
          name: option.name,
          ...(option.description ? { description: option.description } : {}),
        }))
      : [],
  };
}

/** Official selectors use category; old capability snapshots only supplied conventional IDs. */
export function configurationCategory(option: Pick<ConfigOption, 'id' | 'category'>) {
  // Upstream keeps interaction_mode as a generic control, never a permission selector.
  if (option.id === 'interaction_mode') return 'interaction_mode';
  if (option.category !== undefined) return option.category;
  if (new Set(['model', 'modelId']).has(option.id)) return 'model';
  if (new Set(['mode', 'modeId']).has(option.id)) return 'mode';
  return undefined;
}

/** Mirrors upstream acp-selector-options defaults without overwriting an explicit draft choice. */
export function defaultRunSelection(
  snapshot: Pick<
    ClientSnapshot,
    'runModels' | 'permissionModes' | 'configOptions' | 'agents' | 'target'
  >,
  config?: Pick<RunConfig, 'modelId' | 'modeId'>,
) {
  const options = snapshot.configOptions ?? [];
  const modelOption = options.find(
    (option) => option.type === 'select' && configurationCategory(option) === 'model',
  );
  const modeOption = options.find(
    (option) => option.type === 'select' && configurationCategory(option) === 'mode',
  );
  const agent = snapshot.agents.find((row) => row.id === snapshot.target?.agentConfigId);
  const builtinMode =
    agent?.cliType === 'builtin' ? builtinDefaultModeIds.get(agent.agentType ?? '') : undefined;
  const modelDefault = snapshot.runModels.find((row) => row.value === modelOption?.currentValue);
  const modeDefault = snapshot.permissionModes.find(
    (row) => row.value === modeOption?.currentValue,
  );
  const builtinAvailable =
    builtinMode &&
    snapshot.permissionModes.some((row) => row.value === builtinMode) &&
    (!modeOption || modeOption.options.some((row) => row.value === builtinMode));
  return {
    modelId: config?.modelId ?? modelDefault?.value ?? snapshot.runModels[0]?.value ?? '',
    modeId:
      config?.modeId ??
      (builtinAvailable ? builtinMode : modeDefault?.value) ??
      snapshot.permissionModes[0]?.value ??
      '',
  };
}

function isConfigurationValueAvailable(option: ConfigOption, value: string | boolean) {
  return option.type === 'boolean'
    ? v.safeParse(v.boolean(), value).success
    : option.options.some((entry) => entry.value === value);
}

export function defaultConfigurationValues(options: readonly ConfigOption[]) {
  return Object.fromEntries(
    options.map((option) => {
      if (!isConfigurationValueAvailable(option, option.currentValue))
        throw new Error(`Configuration option ${option.id} has an unavailable current value.`);
      return [option.id, option.currentValue];
    }),
  );
}

export function configurationOptionsForModel(
  caps: MachineCapabilities,
  modelId: string,
): ConfigOption[] {
  let options: ConfigOption[] = resolveRunCapabilities(caps).configOptions;
  const binding = getBuiltinModelControlBinding(caps);
  if (!binding) return options;
  const efforts = getModelEffortChoices(caps, modelId);
  if (efforts) {
    const original = options.find((option) => option.id === binding.effortConfigId);
    options = options.filter((option) => option.id !== binding.effortConfigId);
    if (efforts.length) {
      const current = v.safeParse(v.string(), original?.currentValue);
      const support = resolveDeclaredEffortSupport(caps, modelId);
      const fallback = support.state === 'supported' ? support.fallbackValue : efforts[0]!;
      options.push({
        id: binding.effortConfigId,
        name: original?.name ?? binding.effortLabel,
        type: 'select',
        currentValue:
          current.success && efforts.includes(current.output) ? current.output : fallback,
        options: efforts.map((value) => ({
          value,
          name: original?.options.find((option) => option.value === value)?.name ?? value,
        })),
      });
    }
  }
  const fast = getDeclaredModelControls(caps, modelId)?.fastMode;
  if (fast === false) options = options.filter((option) => option.id !== binding.fastConfigId);
  if (fast === true && !options.some((option) => option.id === binding.fastConfigId))
    options.push({
      id: binding.fastConfigId,
      name: 'Fast mode',
      type: 'boolean',
      currentValue: false,
      options: [],
    });
  return options;
}

/** Reconcile picker state when changing models; submission validation never repairs input. */
export function configurationValuesForModel(
  options: readonly ConfigOption[],
  values: Record<string, string | boolean> | undefined,
  modelId: string,
  modeId?: string,
) {
  return Object.fromEntries(
    options.map((option) => {
      const value =
        configurationCategory(option) === 'model' && modelId
          ? modelId
          : modeId && configurationCategory(option) === 'mode'
            ? modeId
            : values?.[option.id];
      return [
        option.id,
        value !== undefined && isConfigurationValueAvailable(option, value)
          ? value
          : option.currentValue,
      ];
    }),
  );
}

export function validateRunConfiguration(
  config: RunConfig | undefined,
  caps: MachineCapabilities,
): RunConfig & { configOptionValues: Record<string, string | boolean> } {
  const catalog = resolveRunCapabilities(caps);
  if (
    !config ||
    (catalog.models.length > 0
      ? !catalog.models.some((model) => model.modelId === config.modelId)
      : Boolean(config.modelId))
  )
    throw new Error('Select an available model.');
  if (config.modeId && !catalog.modes.some((mode) => mode.id === config.modeId))
    throw new Error('Permission mode is unavailable.');
  const options = configurationOptionsForModel(caps, config.modelId ?? '');
  const binding = getBuiltinModelControlBinding(caps);
  const configOptionValues = { ...config.configOptionValues };
  if (config.reasoningEffort) {
    const option = options.find(
      (option) =>
        option.id === binding?.effortConfigId ||
        new Set(['reasoning_effort', 'reasoningEffort']).has(option.id),
    );
    if (!option || !isConfigurationValueAvailable(option, config.reasoningEffort))
      throw new Error('Reasoning effort is unavailable.');
    const suppliedEffort = configOptionValues[option.id];
    if (suppliedEffort !== undefined) {
      if (suppliedEffort !== config.reasoningEffort)
        throw new Error('Reasoning effort conflicts with runtime configuration.');
    }
    configOptionValues[option.id] = config.reasoningEffort;
  }
  if (config.planMode || config.fastMode)
    throw new Error('Select runtime configuration options for plan and fast modes.');
  for (const [id, value] of Object.entries(configOptionValues)) {
    const modelEfforts = getModelEffortChoices(caps, config.modelId ?? '');
    if (
      (id === binding?.effortConfigId ||
        new Set(['reasoning_effort', 'reasoningEffort']).has(id)) &&
      modelEfforts &&
      !new Set<string | boolean>(modelEfforts).has(value)
    )
      throw new Error('Reasoning effort is unavailable for the selected model.');
    const option = options.find((option) => option.id === id);
    if (!option || !isConfigurationValueAvailable(option, value))
      throw new Error(`Configuration option ${id} is unavailable.`);
    if (configurationCategory(option) === 'model' && config.modelId && value !== config.modelId)
      throw new Error('Model conflicts with runtime configuration.');
    if (config.modeId && configurationCategory(option) === 'mode' && value !== config.modeId)
      throw new Error('Permission mode conflicts with runtime configuration.');
  }
  const { modelId, ...rest } = config;
  return { ...rest, ...(modelId ? { modelId } : {}), configOptionValues };
}
