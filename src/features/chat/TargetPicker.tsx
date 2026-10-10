import * as stylex from '@stylexjs/stylex';

import { Icon } from '../../shared/icons/Icon';
import { Badge, Button, Field, Popover, Select } from '../../shared/ui';
import { AgentIcon } from '../../shared/ui/AgentIcon';
import type { ClientSnapshot } from '../connection/client';

const styles = stylex.create({
  panel: { width: 'min(300px, calc(100vw - 24px))', display: 'grid', gap: 12 },
  trigger: { maxWidth: '100%', minWidth: 0, flexShrink: 1 },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  option: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' },
  hint: { margin: 0, fontSize: 13 },
});

export function TargetPicker({
  snapshot,
  open,
  onOpenChange,
  busy,
  locked,
  onMachine,
  onAgent,
  onDiagnostics,
}: {
  snapshot: ClientSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  locked: boolean;
  onMachine: (id: string) => void;
  onAgent: (id: string) => void;
  onDiagnostics?: () => void;
}) {
  const machineId = snapshot.selectedMachineId ?? snapshot.target?.machineId;
  const machines = snapshot.machines.filter((row) => row.name?.trim());
  const machine = machines.find((item) => item.id === machineId);
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="mini"
            disabled={busy}
            aria-label="选择对话助手"
            {...stylex.props(styles.trigger)}
          />
        }
      >
        <Icon name="machine" size={14} />
        <span {...stylex.props(styles.label)}>
          {snapshot.target ? (machine?.name ?? '已连接的机器') : '选择对话助手'}
        </span>
      </Popover.Trigger>
      <Popover.Content side="top" align="start" {...stylex.props(styles.panel)}>
        <Popover.Header>
          <Popover.Title>对话助手</Popover.Title>
          <Popover.Description>
            {locked
              ? '当前会话沿用已有机器与助手。新建对话后可重新选择。'
              : '选好一次，后续新对话会沿用。'}
          </Popover.Description>
        </Popover.Header>
        {!machines.length ? (
          <p {...stylex.props(styles.hint)}>
            还没有连接的机器。在电脑上打开 Lody，并登录同一工作区。
          </p>
        ) : (
          <Field.Root disabled={busy || locked}>
            <Field.Label>运行于</Field.Label>
            <Select.Root
              items={machines.map((row) => ({
                value: row.id,
                label: row.name ?? row.id,
              }))}
              value={machineId ?? null}
              onValueChange={(id) => {
                if (id) onMachine(id);
              }}
            >
              <Select.Trigger>
                <Icon name="machine" size={14} />
                <Select.Value placeholder="选择机器" />
                {machine && <MachineStatus status={machine.status} />}
              </Select.Trigger>
              <Select.Content>
                {machines.map((row) => (
                  <Select.Item
                    key={row.id}
                    value={row.id}
                    endContent={<MachineStatus status={row.status} />}
                  >
                    <span {...stylex.props(styles.option)}>
                      <Icon name="machine" size={14} />
                      <span {...stylex.props(styles.label)}>{row.name}</span>
                    </span>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field.Root>
        )}
        {machineId && (
          <Field.Root disabled={busy || locked || !snapshot.agents.length}>
            <Field.Label>助手</Field.Label>
            <Select.Root
              items={snapshot.agents.map((row) => ({ value: row.id, label: row.name }))}
              value={snapshot.target?.agentConfigId ?? null}
              onValueChange={(id) => {
                if (id) onAgent(id);
              }}
            >
              <Select.Trigger>
                <AgentIcon
                  agent={snapshot.agents.find(
                    (agent) => agent.id === snapshot.target?.agentConfigId,
                  )}
                  size={14}
                />
                <Select.Value placeholder="选择 Agent" />
              </Select.Trigger>
              <Select.Content>
                {snapshot.agents.map((row) => (
                  <Select.Item key={row.id} value={row.id}>
                    <span {...stylex.props(styles.option)}>
                      <AgentIcon agent={row} size={14} />
                      {row.name}
                    </span>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            {!busy && !snapshot.agents.length && (
              <Field.Description>
                这台机器还没有可用助手，请在 Lody 中配置 Agent。
              </Field.Description>
            )}
          </Field.Root>
        )}
        {snapshot.target && (
          <Button size="small" disabled={busy} onClick={() => onOpenChange(false)}>
            完成
          </Button>
        )}
        {onDiagnostics && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              onOpenChange(false);
              onDiagnostics();
            }}
          >
            连接诊断
          </Button>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

function MachineStatus({ status }: { status: ClientSnapshot['machines'][number]['status'] }) {
  return (
    <Badge tone={status === 'online' ? 'success' : 'neutral'}>
      {status === 'online' ? '在线' : status === 'offline' ? '离线' : '状态未知'}
    </Badge>
  );
}
