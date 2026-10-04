import type { MachineCapabilities } from '@lody-mobile/sdk/loro';
import * as v from 'valibot';

import {
  getBuiltinModelControlBinding,
  getDeclaredModelControls,
  getModelEffortChoices,
  resolveDeclaredEffortSupport,
} from '../../../vendor/lody/packages/shared/src/acp-model-capabilities';
import type { ClientSnapshot, RunConfig } from './client';

type ConfigOption = NonNullable<ClientSnapshot['configOptions']>[number];

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
  let options: ConfigOption[] = [...(caps.configOptions ?? [])];
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
      const value = new Set(['model', 'modelId']).has(option.id)
        ? modelId
        : modeId && new Set(['mode', 'modeId']).has(option.id)
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
  if (!config || !caps.models.some((model) => model.modelId === config.modelId))
    throw new Error('Select an available model.');
  if (config.modeId && !caps.modes.some((mode) => mode.id === config.modeId))
    throw new Error('Permission mode is unavailable.');
  const options = configurationOptionsForModel(caps, config.modelId);
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
    const modelEfforts = getModelEffortChoices(caps, config.modelId);
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
    if (new Set(['model', 'modelId']).has(id) && value !== config.modelId)
      throw new Error('Model conflicts with runtime configuration.');
    if (config.modeId && new Set(['mode', 'modeId']).has(id) && value !== config.modeId)
      throw new Error('Permission mode conflicts with runtime configuration.');
  }
  return { ...config, configOptionValues };
}
