import type { MachineCapabilities } from '@lody-mobile/sdk/loro';
import { expect, it } from 'vitest';

import type { Conversation, Message } from '../../src/features/connection/client';
import {
  configurationOptionsForModel,
  configurationValuesForModel,
  defaultConfigurationValues,
  defaultRunSelection,
  inheritedMcpSelection,
  resolveRunCapabilities,
  validateRunConfiguration,
} from '../../src/features/connection/run-configuration';

function mcpTurn(id: string, mcpServerIds?: string[]): Message {
  return {
    id,
    role: 'user',
    text: id,
    contexts: [],
    status: 'complete',
    activities: [],
    turn: {
      id,
      role: 'user',
      timestamp: '2026-10-05T00:00:00Z',
      inputConfig: mcpServerIds === undefined ? {} : { mcpServerIds },
    },
  };
}

it('inherits the latest MCP selection across fresh-start replies and reopening without reviving defaults', () => {
  const conversation: Pick<Conversation, 'messages' | 'queued'> = {
    messages: [mcpTurn('initial-default', ['research'])],
  };
  expect(inheritedMcpSelection(undefined, undefined)).toBeUndefined();
  expect(inheritedMcpSelection(conversation, undefined)).toEqual(['research']);
  const next = inheritedMcpSelection(conversation, undefined)!;
  conversation.messages.push(mcpTurn('follow-up', next));
  expect(inheritedMcpSelection(structuredClone(conversation), undefined)).toEqual(['research']);
  expect(inheritedMcpSelection(conversation, [])).toEqual([]);
  conversation.messages.push(mcpTurn('explicitly-disabled', []));
  expect(inheritedMcpSelection(structuredClone(conversation), undefined)).toEqual([]);
  expect(inheritedMcpSelection({ messages: [mcpTurn('legacy')] }, undefined)).toEqual([]);
  expect(inheritedMcpSelection(undefined, undefined)).toBeUndefined();
});

it('uses the queue tail ahead of history and never scans older turns for missing MCP values', () => {
  const conversation: Pick<Conversation, 'messages' | 'queued'> = {
    messages: [mcpTurn('older', ['old']), mcpTurn('newer')],
    queued: [
      {
        task: 'queued',
        userId: 'user',
        timestamp: '2026-10-05T00:00:00Z',
        acpSessionConfig: { mcpServerIds: ['queued'] },
      },
    ],
  };
  expect(inheritedMcpSelection(conversation, undefined)).toEqual(['queued']);
  expect(inheritedMcpSelection(conversation, ['explicit'])).toEqual(['explicit']);
  const retained = inheritedMcpSelection(conversation, undefined)!;
  retained.push('local-only');
  expect(inheritedMcpSelection(conversation, undefined)).toEqual(['queued']);
  conversation.queued!.push({
    task: 'legacy queue',
    userId: 'user',
    timestamp: '2026-10-05T00:01:00Z',
  });
  expect(inheritedMcpSelection(conversation, undefined)).toEqual([]);
  conversation.queued = [];
  expect(inheritedMcpSelection(conversation, undefined)).toEqual([]);
});

const modelOption: NonNullable<MachineCapabilities['configOptions']>[number] = {
  id: 'model',
  category: 'model',
  name: 'Model',
  type: 'select',
  currentValue: 'model',
  options: [{ value: 'model', name: 'Model' }],
};

const caps: MachineCapabilities = {
  cliType: 'builtin',
  agentType: 'codex',
  fetchedAt: 1,
  models: [{ modelId: 'model', name: 'Model' }],
  modes: [],
  configOptions: [
    modelOption,
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
  expect(defaults).toEqual({
    model: 'model',
    plan_mode: false,
    fast_mode: true,
    reasoning_effort: 'high',
  });
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
      ...(caps.configOptions ?? []).filter((option) => option.id !== 'model'),
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
      modelOption,
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
  expect(options.map((option) => option.id)).toEqual(['model', 'effort']);
  expect(
    options.find((option) => option.id === 'effort')?.options.map((option) => option.value),
  ).toEqual(['default', 'low']);
  expect(configurationValuesForModel(options, { effort: 'high', fast: true }, 'model')).toEqual({
    model: 'model',
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
  expect(options.map((option) => option.id)).toEqual(['model', 'reasoning_effort', 'fast-mode']);
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
  ).toEqual([modelOption]);
  expect(
    configurationOptionsForModel({ ...declared, agentType: 'unknown-agent' }, 'model'),
  ).toEqual([modelOption]);
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
        modelOption,
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
    ).toEqual({ model: 'model', [id]: 'read-only' });
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

it('uses advertised model defaults and Lody builtin mode defaults while preserving explicit choices', () => {
  const snapshot: Parameters<typeof defaultRunSelection>[0] = {
    agents: [{ id: 'codex', name: 'Codex', cliType: 'builtin', agentType: 'codex' }],
    target: {
      workspaceId: 'workspace',
      machineId: 'machine',
      agentConfigId: 'codex',
      project: { kind: 'chat' },
    },
    runModels: ['first', 'current'].map((value) => ({
      value,
      label: value,
      reasoningEfforts: [],
      planMode: false,
      fastMode: false,
    })),
    permissionModes: ['read-only', 'agent-auto-review'].map((value) => ({
      value,
      label: value,
      icon: 'permission',
    })),
    configOptions: [
      {
        id: 'engine',
        category: 'model',
        name: 'Engine',
        type: 'select',
        currentValue: 'current',
        options: [
          { value: 'first', name: 'First' },
          { value: 'current', name: 'Current' },
        ],
      },
      {
        id: 'access',
        category: 'mode',
        name: 'Access',
        type: 'select',
        currentValue: 'read-only',
        options: [
          { value: 'read-only', name: 'Read' },
          { value: 'agent-auto-review', name: 'Auto review' },
        ],
      },
    ],
  };
  expect(defaultRunSelection(snapshot)).toEqual({
    modelId: 'current',
    modeId: 'agent-auto-review',
  });
  expect(defaultRunSelection(snapshot, { modelId: 'first', modeId: 'read-only' })).toEqual({
    modelId: 'first',
    modeId: 'read-only',
  });
  expect(
    defaultRunSelection({ ...snapshot, permissionModes: snapshot.permissionModes.slice(0, 1) })
      .modeId,
  ).toBe('read-only');
  expect(
    defaultRunSelection({
      ...snapshot,
      agents: [{ id: 'codex', name: 'Custom', cliType: 'custom', agentType: 'codex' }],
    }).modeId,
  ).toBe('read-only');
});

it.each([
  ['kimi', 'auto'],
  ['grok', 'default'],
  ['claude', 'auto'],
  ['codex', 'agent-auto-review'],
  ['deepseek', 'workspace-write'],
])(
  'retains the upstream builtin permission default for %s only when advertised',
  (agentType, modeId) => {
    const snapshot: Parameters<typeof defaultRunSelection>[0] = {
      agents: [{ id: 'agent', name: 'Agent', cliType: 'builtin', agentType }],
      target: {
        workspaceId: 'workspace',
        machineId: 'machine',
        agentConfigId: 'agent',
        project: { kind: 'chat' },
      },
      runModels: [],
      permissionModes: [
        { value: 'fallback', label: 'Fallback', icon: 'permission' },
        { value: modeId!, label: 'Default', icon: 'permission' },
      ],
    };
    expect(defaultRunSelection(snapshot).modeId).toBe(modeId);
    expect(
      defaultRunSelection({ ...snapshot, permissionModes: snapshot.permissionModes.slice(0, 1) })
        .modeId,
    ).toBe('fallback');
    expect(
      defaultRunSelection({
        ...snapshot,
        agents: [{ id: 'agent', name: 'Unknown', cliType: 'builtin', agentType: 'unknown' }],
      }).modeId,
    ).toBe('fallback');
  },
);

it('aligns nonstandard category IDs and rejects conflicting model and permission fields', () => {
  const options: NonNullable<MachineCapabilities['configOptions']> = [
    {
      id: 'engine',
      category: 'model',
      name: 'Engine',
      type: 'select',
      currentValue: 'model',
      options: [
        { value: 'model', name: 'Model' },
        { value: 'other', name: 'Other' },
      ],
    },
    {
      id: 'access',
      category: 'mode',
      name: 'Access',
      type: 'select',
      currentValue: 'ask',
      options: [
        { value: 'ask', name: 'Ask' },
        { value: 'read', name: 'Read' },
      ],
    },
    {
      id: 'model',
      category: 'other',
      name: 'Unrelated',
      type: 'select',
      currentValue: 'unrelated',
      options: [{ value: 'unrelated', name: 'Unrelated' }],
    },
  ];
  const categorized: MachineCapabilities = {
    ...caps,
    models: [
      { modelId: 'model', name: 'Model' },
      { modelId: 'other', name: 'Other' },
    ],
    modes: [
      { id: 'ask', name: 'Ask' },
      { id: 'read', name: 'Read' },
    ],
    configOptions: options.map((option) => ({ ...option, options: [...option.options] })),
  };
  const configOptionValues = configurationValuesForModel(
    options,
    { engine: 'model', access: 'ask' },
    'other',
    'read',
  );
  expect(configOptionValues).toEqual({ engine: 'other', access: 'read', model: 'unrelated' });
  expect(
    validateRunConfiguration(
      { ...config, modelId: 'other', modeId: 'read', configOptionValues },
      categorized,
    ).configOptionValues,
  ).toEqual(configOptionValues);
  expect(() =>
    validateRunConfiguration({ ...config, configOptionValues: { engine: 'other' } }, categorized),
  ).toThrow('Model conflicts');
  expect(() =>
    validateRunConfiguration(
      { ...config, modeId: 'read', configOptionValues: { access: 'ask' } },
      categorized,
    ),
  ).toThrow('Permission mode conflicts');
});

it('omits modelId for agents with no model selector without accepting a fabricated model', () => {
  const noModels: MachineCapabilities = { ...caps, models: [], configOptions: [] };
  const { modelId: _modelId, ...withoutModel } = config;
  expect(validateRunConfiguration(withoutModel, noModels)).not.toHaveProperty('modelId');
  expect(validateRunConfiguration({ ...withoutModel, modelId: '' }, noModels)).not.toHaveProperty(
    'modelId',
  );
  expect(() => validateRunConfiguration(config, noModels)).toThrow('Select an available model.');
  expect(() => validateRunConfiguration(withoutModel, caps)).toThrow('Select an available model.');
});

it('uses category catalogs even with empty legacy arrays and never revives stale legacy entries', () => {
  const advertised: MachineCapabilities = {
    ...caps,
    models: [],
    modes: [],
    configOptions: [modelOption],
  };
  expect(resolveRunCapabilities(advertised).models).toEqual([{ modelId: 'model', name: 'Model' }]);
  expect(validateRunConfiguration(config, advertised).modelId).toBe('model');
  const noSelector = {
    ...caps,
    configOptions: [
      { id: 'plan', name: 'Plan', type: 'boolean' as const, currentValue: false, options: [] },
    ],
  };
  expect(resolveRunCapabilities(noSelector).models).toEqual([]);
  expect(() => validateRunConfiguration(config, noSelector)).toThrow('Select an available model');
});

it.each(['registry', 'custom'] as const)(
  'keeps %s category selections in configOptionValues only',
  (cliType) => {
    const probed: MachineCapabilities = {
      ...caps,
      cliType,
      models: [],
      modes: [],
      configOptions: [
        { ...modelOption, id: 'engine' },
        {
          id: 'access',
          category: 'mode',
          name: 'Access',
          type: 'select',
          currentValue: 'ask',
          options: [{ value: 'ask', name: 'Ask' }],
        },
      ],
    };
    const catalog = resolveRunCapabilities(probed);
    expect(catalog.models).toEqual([]);
    expect(catalog.modes).toEqual([]);
    const input = {
      reasoningEffort: '',
      planMode: false,
      fastMode: false,
      configOptionValues: configurationValuesForModel(catalog.configOptions, undefined, ''),
    };
    const validated = validateRunConfiguration(input, probed);
    expect(validated.configOptionValues).toEqual({ engine: 'model', access: 'ask' });
    expect(validated).not.toHaveProperty('modelId');
    expect(validated).not.toHaveProperty('modeId');
    expect(() => validateRunConfiguration({ ...input, modelId: 'model' }, probed)).toThrow(
      'Select an available model',
    );
  },
);
