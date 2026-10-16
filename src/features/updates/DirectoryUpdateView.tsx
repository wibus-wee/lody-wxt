import * as stylex from '@stylexjs/stylex';

import { Alert, Button } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';

const styles = stylex.create({
  stack: { display: 'grid', gap: 8 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: composer.hint },
});
type Props = {
  directoryName: string | null;
  pending: { version: string; phase: 'prepared' | 'applied' } | null;
  busy: boolean;
  needsPermission: boolean;
  authorize: () => void;
  canUpdate: boolean;
  message: string | null;
  error: string | null;
  bind: () => void;
  update: () => void;
  resume: () => void;
  rollback: () => void;
  cancel: () => void;
};
export function DirectoryUpdateView({
  directoryName,
  pending,
  busy,
  needsPermission,
  authorize,
  canUpdate,
  message,
  error,
  bind,
  update,
  resume,
  rollback,
  cancel,
}: Props) {
  return (
    <section aria-label="目录更新" {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.hint)}>
        选择当前加载的 lody 文件夹后，可直接写入更新，无需手动下载、解压和覆盖。
      </p>
      <p {...stylex.props(styles.hint)}>
        {directoryName ? `安装目录：${directoryName}` : '尚未绑定安装目录'}
      </p>
      <output aria-live="polite" {...stylex.props(styles.hint)}>
        {message ??
          (pending
            ? `待恢复更新：${pending.version}（${pending.phase === 'applied' ? '已写入，等待重载' : '尚未完成'}）`
            : '')}
      </output>
      {error && (
        <Alert.Root tone="warning">
          <p {...stylex.props(styles.hint)}>{error}</p>
        </Alert.Root>
      )}
      <div {...stylex.props(styles.actions)}>
        {needsPermission && (
          <Button size="small" disabled={busy} onClick={authorize}>
            恢复目录授权
          </Button>
        )}
        <Button size="small" variant="secondary" disabled={busy} onClick={bind}>
          {pending ? '重新选择原目录' : '选择安装目录'}
        </Button>
        <Button size="small" disabled={busy || !!pending || !canUpdate} onClick={update}>
          下载并写入更新
        </Button>
        {pending?.phase === 'prepared' && (
          <Button size="small" disabled={busy || needsPermission} onClick={resume}>
            继续未完成的更新
          </Button>
        )}
        {pending && (
          <Button
            size="small"
            variant="secondary"
            disabled={busy || needsPermission}
            onClick={rollback}
          >
            恢复更新前文件
          </Button>
        )}
        {busy && (
          <Button size="small" variant="secondary" onClick={cancel}>
            停止，保留恢复记录
          </Button>
        )}
      </div>
      <p {...stylex.props(styles.hint)}>
        写入前保留备份。若权限已失效，可恢复已保存目录的授权；目录已移动或不可访问时，再重新选择原安装目录。重新加载前请保存草稿并结束正在发送的操作。
      </p>
    </section>
  );
}
