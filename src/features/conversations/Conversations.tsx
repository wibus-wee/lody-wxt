import { colors } from '@lody/ui/tokens/colors.stylex';
import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Dialog, Field, Menu, Select, Tooltip } from '../../shared/ui';
import type { Conversation, ExecutionTarget, LodyClient } from '../connection/client';

const styles = stylex.create({
  form: { display: 'grid', gap: 16 },
  title: { maxWidth: 250, minWidth: 0, justifyContent: 'start', flexShrink: 1 },
  truncate: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  identity: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  workspace: {
    color: colors.secondaryLabel,
    fontSize: text.captionSize,
    margin: 0,
    lineHeight: text.captionLeading,
  },
});
const workspaces = [{ value: 'demo-workspace', label: '个人工作区 · 演示' }];
const machines = [{ value: 'demo-machine', label: '演示机器 · 在线' }];
const agents = [{ value: 'demo-agent', label: 'Lody 演示 Agent' }];

export function Conversations({
  client,
  sessions,
  selected,
  workspaceName,
  onSelect,
  onError,
}: {
  client: LodyClient;
  sessions: Conversation[];
  selected: string;
  workspaceName: string;
  onSelect: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const current = sessions.find((session) => session.id === selected);
  const create = async () => {
    setCreating(true);
    const target: ExecutionTarget = {
      workspaceId: 'demo-workspace',
      machineId: 'demo-machine',
      agentConfigId: 'demo-agent',
      project: { kind: 'chat' },
    };
    try {
      const session = await client.create(target);
      onSelect(session.id);
      setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : '无法新建会话。');
    }
    setCreating(false);
  };
  return (
    <>
      <div {...stylex.props(styles.identity)}>
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="small"
                aria-label="会话列表"
                {...stylex.props(styles.title)}
              />
            }
          >
            <Icon name="history" size={16} />
            <span {...stylex.props(styles.truncate)}>{current?.title ?? '新会话'}</span>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Group>
              <Menu.GroupLabel>
                {workspaceName} · {client.accountKey.startsWith('demo:') ? '演示' : '真实账户'}
              </Menu.GroupLabel>
              {sessions.length === 0 && <Menu.Item disabled>暂无会话</Menu.Item>}
              {sessions.map((session) => (
                <Menu.Item
                  key={session.id}
                  icon={<Icon name="chat" size="100%" />}
                  shortcut={session.id === selected ? '当前' : undefined}
                  onClick={() => onSelect(session.id)}
                >
                  {session.title}
                </Menu.Item>
              ))}
            </Menu.Group>
          </Menu.Content>
        </Menu.Root>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Dialog.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="small"
                    icon
                    aria-label="新建会话"
                    disabled={!client.accountKey.startsWith('demo:')}
                  />
                }
              />
            }
          >
            <Icon name="new" size={18} />
          </Tooltip.Trigger>
          <Tooltip.Content>新建会话</Tooltip.Content>
        </Tooltip.Root>
        <Dialog.Content width={360} closeLabel="关闭新建会话">
          <Dialog.Header>
            <Dialog.Title>新建 Lody 会话</Dialog.Title>
            <Dialog.Description>选择会话的执行目标。演示目标不会操作你的机器。</Dialog.Description>
          </Dialog.Header>
          <div {...stylex.props(styles.form)}>
            <Field.Root>
              <Field.Label>工作区</Field.Label>
              <Select.Root items={workspaces} defaultValue="demo-workspace">
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {workspaces.map((item) => (
                    <Select.Item key={item.value} value={item.value}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label>机器</Field.Label>
              <Select.Root items={machines} defaultValue="demo-machine">
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {machines.map((item) => (
                    <Select.Item key={item.value} value={item.value}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label>Agent 配置</Field.Label>
              <Select.Root items={agents} defaultValue="demo-agent">
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {agents.map((item) => (
                    <Select.Item key={item.value} value={item.value}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>
          </div>
          <Dialog.Footer>
            <Button disabled={creating} onClick={() => void create()}>
              创建会话
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
