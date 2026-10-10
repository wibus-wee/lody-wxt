import type { Meta, StoryObj } from '@storybook/react-vite';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Button } from '../../shared/ui';
import type { ClientSnapshot } from '../connection/client';
import { TargetPicker } from './TargetPicker';

const styles = stylex.create({
  page: { minHeight: 480, padding: 24, display: 'flex', alignItems: 'flex-end', gap: 12 },
});
const machines: ClientSnapshot['machines'] = [
  { id: 'unnamed', name: null, status: 'online' },
  { id: 'blank', name: '   ', status: 'online' },
  { id: 'mac', name: 'workstation-Mac-Studio.local', status: 'online' },
  { id: 'laptop', name: 'MacBook Pro', status: 'offline' },
];

function Example({ unnamedOnly = false }: { unnamedOnly?: boolean }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState('mac');
  const [connected, setConnected] = useState(true);
  const snapshot: ClientSnapshot = {
    mode: 'real',
    status: 'connected',
    error: null,
    conversations: [],
    target: null,
    machineIds: machines.map((row) => row.id),
    selectedMachineId: selected,
    machines: (unnamedOnly ? machines.slice(0, 2) : machines).map((row) => ({
      ...row,
      status: connected ? (row.status ?? 'unknown') : 'unknown',
    })),
    agents: [{ id: 'codex', name: 'Codex', cliType: 'builtin', agentType: 'codex' }],
    runModels: [],
    permissionModes: [],
    busy: false,
  };
  return (
    <div {...stylex.props(styles.page)}>
      <TargetPicker
        snapshot={snapshot}
        open={open}
        onOpenChange={setOpen}
        busy={false}
        locked={false}
        onMachine={setSelected}
        onAgent={() => {}}
      />
      <Button onClick={() => setConnected((value) => !value)}>切换状态连接</Button>
    </div>
  );
}

const meta = {
  title: 'Chat/TargetPicker',
  component: Example,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MachineAvailability: Story = { render: () => <Example /> };
export const UnnamedMachines: Story = { render: () => <Example unnamedOnly /> };
