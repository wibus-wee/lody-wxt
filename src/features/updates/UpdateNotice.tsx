import * as stylex from '@stylexjs/stylex';

import { Alert, Button } from '../../shared/ui';
import { Card } from '../../shared/ui/card';
import { composer } from '../../shared/ui/composer.stylex';
import type { UpdateState } from './appcast';
import { availableRelease, compareVersions } from './appcast';
import { useUpdates } from './use-updates';

const styles = stylex.create({
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  hint: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: composer.hint,
    overflowWrap: 'anywhere',
  },
  description: { margin: 0, fontSize: 12, lineHeight: 1.5, color: composer.label },
});

type NoticeProps = {
  installedVersion: string | null;
  state?: UpdateState | undefined;
  busy: boolean;
  error: string | null;
  check: () => void;
  skip: (version: string | null) => void;
};

export function UpdateNotice({ installedVersion, state, busy, error, check, skip }: NoticeProps) {
  const release = installedVersion && state ? availableRelease(state, installedVersion) : null;
  const failure = error ?? state?.error;
  const skipped = release && state?.skippedVersion === release.version;
  // Preserve native link semantics when Base UI renders a Button as an anchor.
  const actions = release && (
    <div {...stylex.props(styles.actions)}>
      <Button
        size="small"
        nativeButton={false}
        render={(props) => {
          const anchorProps = { ...props };
          delete anchorProps.role;
          return (
            <a
              {...anchorProps}
              href={release.enclosure.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="下载新版 ZIP"
            />
          );
        }}
      >
        下载新版 ZIP
      </Button>
      <Button
        size="small"
        variant="secondary"
        nativeButton={false}
        render={(props) => {
          const anchorProps = { ...props };
          delete anchorProps.role;
          return (
            <a
              {...anchorProps}
              href={release.releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="更新日志"
            />
          );
        }}
      >
        更新日志
      </Button>
      <Button
        size="small"
        variant="secondary"
        nativeButton={false}
        render={(props) => {
          const anchorProps = { ...props };
          delete anchorProps.role;
          return (
            <a
              {...anchorProps}
              href={release.installationUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="更新步骤"
            />
          );
        }}
      >
        更新步骤
      </Button>
      <Button
        size="small"
        variant="secondary"
        disabled={busy}
        onClick={() => skip(skipped ? null : release.version)}
      >
        {skipped ? '恢复此版本提醒' : '跳过此版本'}
      </Button>
    </div>
  );
  const status = !installedVersion
    ? '更新检查在已安装的扩展中可用。'
    : release
      ? `${failure ? '上次确认的可用版本' : '可用版本'}：${release.version}${skipped ? '（已跳过提醒）' : ''}`
      : state?.release && !failure
        ? compareVersions(installedVersion, state.release.version) === 0
          ? '已是最新稳定版。'
          : '当前安装版本高于更新源版本。'
        : '尚未成功检查更新。';
  return (
    <section aria-label="扩展更新">
      <Card.Root>
        <Card.Header>
          <Card.Title>扩展更新</Card.Title>
        </Card.Header>
        <div {...stylex.props(styles.stack)}>
          {installedVersion && <p {...stylex.props(styles.hint)}>当前版本：{installedVersion}</p>}
          <output {...stylex.props(styles.hint)}>{busy ? '正在检查更新…' : status}</output>
          {failure && (
            <Alert.Root tone="warning">
              <p {...stylex.props(styles.description)}>{failure}</p>
            </Alert.Root>
          )}
          {actions}
          <div {...stylex.props(styles.actions)}>
            <Button
              size="small"
              variant="secondary"
              disabled={!installedVersion || busy}
              onClick={check}
            >
              检查更新
            </Button>
          </div>
          {state?.checkedAt && (
            <p {...stylex.props(styles.hint)}>
              上次成功检查：{new Date(state.checkedAt).toLocaleString()}
            </p>
          )}
          <p {...stylex.props(styles.hint)}>
            每 6 小时自动检查。发现新版后仍需下载 ZIP，覆盖原目录并重新加载；不要卸载扩展。
          </p>
        </div>
      </Card.Root>
    </section>
  );
}

export function UpdateSettings() {
  return <UpdateNotice {...useUpdates()} />;
}
