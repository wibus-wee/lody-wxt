import type { MachineCapabilities } from '@lody-mobile/sdk/loro';
import { expect, it } from 'vitest';

import {
  configurationOptionsForModel,
  configurationValuesForModel,
  defaultConfigurationValues,
  validateRunConfiguration,
} from '../../src/features/connection/run-configuration';

const caps: MachineCapabilities = {
  cliType: 'builtin',
  agentType: 'codex',
  fetchedAt: 1,
  models: [{ modelId: 'model', name: 'Model' }],
  modes: [],
  configOptions: [
    { id: 'plan_mode', name: 'Plan', type: 'boolean', currentValue: false, options: [] },
    { id: 'fast_mode', name: 'Fast', type: 'boolean', currentValue: true, options: [] },
    {
      id: 'reasoning_effort',
      name: 'Reasoning',
      type: 'select',
      currentValue: 'high',
      options: [{ value: 'high', name: 'High' }],
    },
  ],
};
const config = {
  modelId: 'model',
  reasoningEffort: '',
  planMode: false,
  fastMode: false,
};

it('accepts both boolean values without requiring select choices and freezes submitted values', () => {
  const defaults = defaultConfigurationValues(caps.configOptions ?? []);
  expect(defaults).toEqual({ plan_mode: false, fast_mode: true, reasoning_effort: 'high' });
  for (const value of [false, true]) {
    const submitted = { ...config, configOptionValues: { ...defaults, plan_mode: value } };
    const validated = validateRunConfiguration(submitted, caps);
    submitted.configOptionValues.plan_mode = !value;
    expect(validated.configOptionValues.plan_mode).toBe(value);
    expect(validated.configOptionValues.fast_mode).toBe(true);
  }
});

it('rejects removed options, invalid boolean types and unavailable select choices explicitly', () => {
  for (const values of [{ removed: false }, { plan_mode: 'false' }, { reasoning_effort: 'low' }])
    expect(() => validateRunConfiguration({ ...config, configOptionValues: values }, caps)).toThrow(
      'Configuration option',
    );
  expect(() => validateRunConfiguration({ ...config, modelId: 'removed-model' }, caps)).toThrow(
    'Select an available model.',
  );
  expect(() =>
    validateRunConfiguration(
      { ...config, configOptionValues: { plan_mode: false } },
      { ...caps, configOptions: [] },
    ),
  ).toThrow('Configuration option plan_mode is unavailable.');
});
it('rejects model configuration that contradicts the selected model', () => {
  const modelCaps = {
    ...caps,
    models: [...caps.models, { modelId: 'other', name: 'Other' }],
    configOptions: [
      ...(caps.configOptions ?? []),
      {
        id: 'model',
        name: 'Model',
        type: 'select' as const,
        currentValue: 'model',
        options: [
          { value: 'model', name: 'Model' },
          { value: 'other', name: 'Other' },
        ],
      },
    ],
  };
  expect(() =>
    validateRunConfiguration({ ...config, configOptionValues: { model: 'other' } }, modelCaps),
  ).toThrow('Model conflicts with runtime configuration.');
  expect(() =>
    validateRunConfiguration(
      { ...config, configOptionValues: { reasoning_effort: 'high' } },
      { ...caps, modelReasoningEfforts: { model: ['low'] } },
    ),
  ).toThrow('Reasoning effort is unavailable for the selected model.');
});

it('uses the selected model declaration for Claude effort and Fast instead of the probe model', () => {
  const claude: MachineCapabilities = {
    ...caps,
    agentType: 'claude',
    configOptions: [
      {
        id: 'effort',
        name: 'Effort',
        type: 'select',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }],
      },
      { id: 'fast', name: 'Fast', type: 'boolean', currentValue: true, options: [] },
    ],
    declaredModelControls: { model: { effortValues: ['low'], fastMode: false } },
  };
  const options = configurationOptionsForModel(claude, 'model');
  expect(options.map((option) => option.id)).toEqual(['effort']);
  expect(options[0]?.options.map((option) => option.value)).toEqual(['default', 'low']);
  expect(configurationValuesForModel(options, { effort: 'high', fast: true }, 'model')).toEqual({
    effort: 'default',
  });
  for (const effort of ['low', 'default'])
    expect(
      validateRunConfiguration({ ...config, configOptionValues: { effort } }, claude)
        .configOptionValues,
    ).toEqual({ effort });
  expect(() =>
    validateRunConfiguration({ ...config, configOptionValues: { effort: 'high' } }, claude),
  ).toThrow('selected model');
  expect(() =>
    validateRunConfiguration({ ...config, configOptionValues: { fast: true } }, claude),
  ).toThrow('Configuration option fast');
});

it('restores declared controls absent from the probed model and preserves unknown model controls', () => {
  const declared: MachineCapabilities = {
    ...caps,
    configOptions: [],
    declaredModelControls: { model: { effortValues: ['low', 'high'], fastMode: true } },
  };
  const options = configurationOptionsForModel(declared, 'model');
  expect(options.map((option) => option.id)).toEqual(['reasoning_effort', 'fast-mode']);
  expect(
    validateRunConfiguration(
      { ...config, configOptionValues: { reasoning_effort: 'low', 'fast-mode': true } },
      declared,
    ).configOptionValues,
  ).toEqual({ reasoning_effort: 'low', 'fast-mode': true });
  expect(
    configurationOptionsForModel(
      { ...caps, declaredModelControls: { other: { effortValues: [] } } },
      'model',
    ),
  ).toEqual(caps.configOptions);
  expect(
    configurationOptionsForModel({ ...caps, declaredModelControls: { model: {} } }, 'model'),
  ).toEqual(caps.configOptions);
  expect(
    configurationOptionsForModel(
      { ...declared, agentType: 'claude', declaredModelControls: { model: {} } },
      'model',
    ),
  ).toEqual([]);
  expect(
    configurationOptionsForModel({ ...declared, agentType: 'unknown-agent' }, 'model'),
  ).toEqual([]);
});

it.each(['mode', 'modeId'])(
  'keeps %s aligned with the permission picker and rejects contradictory submissions',
  (id) => {
    const permissionCaps: MachineCapabilities = {
      ...caps,
      modes: [
        { id: 'read-only', name: 'Read-only' },
        { id: 'ask', name: 'Ask' },
      ],
      configOptions: [
        {
          id,
          name: 'Mode',
          type: 'select',
          currentValue: 'ask',
          options: [
            { value: 'read-only', name: 'Read-only' },
            { value: 'ask', name: 'Ask' },
          ],
        },
      ],
    };
    const values = configurationValuesForModel(
      permissionCaps.configOptions!,
      { [id]: 'ask' },
      'model',
      'read-only',
    );
    expect(
      validateRunConfiguration(
        { ...config, modeId: 'read-only', configOptionValues: values },
        permissionCaps,
      ).configOptionValues,
    ).toEqual({ [id]: 'read-only' });
    expect(() =>
      validateRunConfiguration(
        { ...config, modeId: 'read-only', configOptionValues: { [id]: 'ask' } },
        permissionCaps,
      ),
    ).toThrow('Permission mode conflicts');
    expect(
      validateRunConfiguration(
        { ...config, configOptionValues: { [id]: 'ask' } },
        { ...permissionCaps, modes: [] },
      ).configOptionValues,
    ).toEqual({ [id]: 'ask' });
  },
);
