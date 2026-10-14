import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { isExtension } from '../../shared/storage';
import { Alert, Button, Field, Switch } from '../../shared/ui';
import { Card } from '../../shared/ui/card';
import { Collapsible } from '../../shared/ui/collapsible';
import { composer } from '../../shared/ui/composer.stylex';
import { getNotificationState, setNotificationsEnabled, watchNotificationState } from './client';
import type { NotificationState } from './model';
import { notificationMessage } from './model';

const styles = stylex.create({
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  hint: {
    color: composer.hint,
    fontSize: 12,
    lineHeight: 1.5,
    margin: 0,
    overflowWrap: 'anywhere',
  },
  events: { margin: 0, paddingInlineStart: 20, display: 'grid', gap: 8 },
});

export function NotificationSettings() {
  const [state, setState] = useState<NotificationState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const read = () => {
      void getNotificationState()
        .then((next) => {
          if (active) setState(next);
        })
        .catch((reason: Error) => {
          if (active) setError(reason.message);
        });
    };
    read();
    const unwatch = watchNotificationState(read);
    return () => {
      active = false;
      unwatch();
    };
  }, []);
  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>任务通知</Card.Title>
      </Card.Header>
      <div {...stylex.props(styles.stack)}>
        <Field.Root disabled={!isExtension() || busy || !state}>
          <div {...stylex.props(styles.row)}>
            <Field.Label htmlFor="task-notifications">会话完成或需要处理时通知我</Field.Label>
            <Switch
              id="task-notifications"
              checked={state?.enabled ?? false}
              onCheckedChange={(enabled) => {
                setBusy(true);
                setError('');
                void setNotificationsEnabled(enabled)
                  .then(setState)
                  .catch((reason: Error) => setError(reason.message))
                  .finally(() => setBusy(false));
              }}
            />
          </div>
          <Field.Description>
            {isExtension()
              ? '关闭侧栏后仍会检查已关注的会话；正在查看的对话不会重复提醒。'
              : '系统通知在浏览器扩展中可用。'}
          </Field.Description>
        </Field.Root>
        <p {...stylex.props(styles.hint)}>
          开启后约每分钟同步一次任务状态，通知不包含消息正文。浏览器关闭时不检查；远端任务仍由运行机器执行。
        </p>
        {(error || state?.error) && (
          <Alert.Root tone="warning">
            <Alert.Description>{error || state?.error}</Alert.Description>
          </Alert.Root>
        )}
        {!!state?.events.length && (
          <Collapsible.Root>
            <Collapsible.Trigger render={<Button variant="ghost" size="small" />}>
              最近任务通知
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <ul aria-label="最近任务通知" {...stylex.props(styles.events)}>
                {state.events
                  .slice(-5)
                  .toReversed()
                  .map((event) => (
                    <li key={event.id} {...stylex.props(styles.hint)}>
                      {notificationMessage(event.kind)} · {new Date(event.at).toLocaleString()}
                    </li>
                  ))}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
        )}
      </div>
    </Card.Root>
  );
}
