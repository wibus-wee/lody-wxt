import { expect, it } from 'vitest';

import { resolveResendConfiguration } from '../../src/features/chat/conversation-actions';
import type { RunConfig } from '../../src/features/connection/client';

const empty: RunConfig = { reasoningEffort: '', planMode: false, fastMode: false };
const current: RunConfig = {
  ...empty,
  modelId: 'current-model',
  modeId: 'read-only',
  configOptionValues: { model: 'current-model', mode: 'read-only', reasoning_effort: 'high' },
  mcpServerIds: ['current-connector'],
};

it('resends legacy prompt-only and projected empty configs with the current explicit selection', () => {
  for (const saved of [undefined, empty, { ...empty, configOptionValues: {} }]) {
    expect(resolveResendConfiguration(saved, current)).toEqual({
      config: current,
      usesCurrent: true,
    });
  }
});

it('retains historical MCP ids including explicit removal while filling a missing legacy run selection', () => {
  for (const mcpServerIds of [[], ['original-connector']]) {
    const saved = { ...empty, mcpServerIds };
    const resolved = resolveResendConfiguration(saved, current);
    expect(resolved).toEqual({ config: { ...current, mcpServerIds }, usesCurrent: true });
    resolved.config!.mcpServerIds!.push('local-edit');
    expect(saved.mcpServerIds).toEqual(mcpServerIds);
    expect(current.mcpServerIds).toEqual(['current-connector']);
  }
});

it('keeps saved builtin and model-less generic run selections rather than replacing their controls', () => {
  for (const saved of [
    { ...empty, modelId: 'historical-model', mcpServerIds: [] },
    { ...empty, configOptionValues: { engine: 'custom-engine', access: 'ask' }, mcpServerIds: [] },
  ]) {
    expect(resolveResendConfiguration(saved, current)).toEqual({
      config: saved,
      usesCurrent: false,
    });
  }
  const generic = resolveResendConfiguration(empty, empty);
  expect(generic.config).toEqual(empty);
  expect(generic.config).not.toHaveProperty('modelId');
});

it('does not manufacture a run selection when neither history nor the current capabilities provide it', () => {
  expect(resolveResendConfiguration(undefined, undefined)).toEqual({
    config: undefined,
    usesCurrent: false,
  });
  expect(resolveResendConfiguration(empty, undefined)).toEqual({
    config: empty,
    usesCurrent: false,
  });
});
