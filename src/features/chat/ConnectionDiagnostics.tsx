import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { browser } from 'wxt/browser';

import { isExtension } from '../../shared/storage';
import { Button } from '../../shared/ui';
import { Dialog } from '../../shared/ui/dialog';
import type { ClientSnapshot } from '../connection/client';

const styles = stylex.create({
  preview: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: '45dvh',
    overflowY: 'auto',
    fontSize: 12,
    margin: 0,
  },
});

export function ConnectionDiagnostics({
  snapshot,
  sessionId,
  onClose,
}: {
  snapshot: ClientSnapshot;
  sessionId: string;
  onClose: () => void;
}) {
  const [report] = useState(() =>
    JSON.stringify(
      {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        surface: isExtension() ? 'extension' : 'web',
        extensionVersion: isExtension() ? browser.runtime.getManifest().version : null,
        connection: snapshot.status,
        failurePresent: !!snapshot.error,
        workspaceId: snapshot.target?.workspaceId ?? null,
        machineId: snapshot.target?.machineId ?? null,
        agentConfigId: snapshot.target?.agentConfigId ?? null,
        sessionId: sessionId || null,
        delivery: snapshot.admission ?? null,
        capabilities: {
          steer: snapshot.canSteer ?? false,
          fork: snapshot.canFork ?? false,
          pageActions: false,
        },
        available: {
          machines: snapshot.machines.length,
          agents: snapshot.agents.length,
          models: snapshot.runModels.length,
        },
        environment: {
          online: navigator.onLine,
          reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          viewport: { width: innerWidth, height: innerHeight },
        },
      },
      null,
      2,
    ),
  );
  const [error, setError] = useState('');
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Title>连接诊断</Dialog.Title>
        <Dialog.Description>
          预览这次诊断快照后再导出。包含版本、状态及工作区与会话标识；不收集凭证、消息、网页正文或原始错误内容。
        </Dialog.Description>
        <pre aria-label="诊断快照" {...stylex.props(styles.preview)}>
          {report}
        </pre>
        {error && <output role="alert">{error}</output>}
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button
            onClick={() => {
              try {
                const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'lody-diagnostics.json';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : '无法导出诊断。');
              }
            }}
          >
            导出诊断
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
