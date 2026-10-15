import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { Alert, Button, Field, Switch, Textarea } from '../../shared/ui';
import { Card } from '../../shared/ui/card';
import { composer } from '../../shared/ui/composer.stylex';
import { clearAttachmentScope } from '../chat/attachment-drafts';
import type { BrowserAccess } from './browser-permissions';
import { readBrowserAccess, revokeBrowserAccess } from './browser-permissions';
import type { PersonalMemory } from './memory';
import {
  deletePersonalMemory,
  readPersonalMemory,
  savePersonalMemory,
  subscribePersonalMemory,
} from './memory';

const styles = stylex.create({
  stack: { display: 'grid', gap: 16, minWidth: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minWidth: 0,
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  label: { minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 },
  hint: { margin: 0, color: composer.hint, fontSize: 13, lineHeight: 1.5 },
});
const permissionLabels: Record<string, string> = {
  history: '浏览历史',
  bookmarks: '书签',
  notifications: '系统通知',
  downloads: '下载',
  tabs: '标签页',
  scripting: '读取已授权页面',
  sidePanel: '侧栏',
  storage: '本地存储',
  activeTab: '当前标签页',
  contextMenus: '右键菜单',
};
export function BrowserPrivacySettings({
  scope,
  section = 'privacy',
}: {
  scope?: string;
  section?: 'privacy' | 'conversation';
}) {
  const [access, setAccess] = useState<BrowserAccess | null>(null);
  const [memory, setMemory] = useState<PersonalMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const refresh = async () => {
    setAccess(await readBrowserAccess());
  };
  useEffect(() => {
    let active = true;
    void readBrowserAccess()
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取浏览器权限。');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (!active) return;
      try {
        setMemory(scope ? readPersonalMemory(scope) : null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法读取个人偏好。');
      }
    };
    queueMicrotask(load);
    const unsubscribe = scope ? subscribePersonalMemory(scope, load) : undefined;
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scope]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作未完成，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={section === 'privacy' ? '浏览器隐私' : '对话偏好'}
    >
      {section === 'privacy' && (
        <Card.Root>
          <Card.Header>
            <Card.Title>浏览器访问</Card.Title>
            <Card.Description>
              只会发送你选择的资料。撤销权限后，后续读取需要重新授权。
            </Card.Description>
          </Card.Header>
          {access ? (
            <div {...stylex.props(styles.stack)}>
              {access.origins.map((origin) => (
                <div key={origin.pattern} {...stylex.props(styles.row)}>
                  <span {...stylex.props(styles.label)}>{origin.pattern}</span>
                  {origin.required ? (
                    <span {...stylex.props(styles.hint)}>连接必需</span>
                  ) : (
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await revokeBrowserAccess('origin', origin.pattern);
                          await refresh();
                          setStatus('网站访问权限已撤销。');
                        })
                      }
                      aria-label={`撤销 ${origin.pattern}`}
                    >
                      撤销
                    </Button>
                  )}
                </div>
              ))}
              {access.permissions
                .filter((permission) => !permission.required)
                .map((permission) => (
                  <div key={permission.name} {...stylex.props(styles.row)}>
                    <span {...stylex.props(styles.label)}>
                      {permissionLabels[permission.name] ?? permission.name}
                    </span>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await revokeBrowserAccess('permission', permission.name);
                          await refresh();
                          setStatus('权限已撤销。');
                        })
                      }
                      aria-label={`撤销${permissionLabels[permission.name] ?? permission.name}`}
                    >
                      撤销
                    </Button>
                  </div>
                ))}
              {!access.origins.length &&
                !access.permissions.some((permission) => !permission.required) && (
                  <p {...stylex.props(styles.hint)}>尚未授予额外的网站访问权限。</p>
                )}
            </div>
          ) : (
            <p {...stylex.props(styles.hint)}>请在扩展中查看和撤销浏览器权限。</p>
          )}
        </Card.Root>
      )}
      {section === 'conversation' && (
        <Card.Root>
          <Card.Header>
            <Card.Title>回复指令与背景</Card.Title>
            <Card.Description>
              由你填写，保存于此浏览器的当前账户和工作区。开启后作为可见参考随新消息发送。
            </Card.Description>
          </Card.Header>
          {scope && memory ? (
            <div {...stylex.props(styles.stack)}>
              <Field.Root disabled={busy}>
                <div {...stylex.props(styles.row)}>
                  <Field.Label htmlFor="personal-memory-enabled">在新消息中使用</Field.Label>
                  <Switch
                    id="personal-memory-enabled"
                    checked={memory.enabled}
                    onCheckedChange={(enabled) =>
                      void run(async () => {
                        setMemory(await savePersonalMemory(scope, { ...memory, enabled }));
                      })
                    }
                  />
                </div>
                <Field.Description>
                  只读取你写下的内容，不会自动学习网页或聊天记录。
                </Field.Description>
              </Field.Root>
              <Field.Root disabled={busy}>
                <Field.Label htmlFor="personal-memory-text">回复偏好与背景</Field.Label>
                <Textarea
                  id="personal-memory-text"
                  rows={5}
                  maxLength={4000}
                  value={memory.text}
                  onChange={(event) => setMemory({ ...memory, text: event.target.value })}
                  placeholder="例如：默认使用中文，先给结论，再给依据。"
                />
                <Field.Description>{memory.text.length} / 4000</Field.Description>
              </Field.Root>
              <div {...stylex.props(styles.actions)}>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setMemory(await savePersonalMemory(scope, memory));
                      setStatus('个人偏好已保存。');
                    })
                  }
                >
                  保存偏好
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy || !memory.text}
                  onClick={() =>
                    void run(async () => {
                      await deletePersonalMemory(scope);
                      setMemory(readPersonalMemory(scope));
                      setStatus('个人偏好已删除并关闭。');
                    })
                  }
                >
                  删除偏好
                </Button>
              </div>
            </div>
          ) : (
            <p {...stylex.props(styles.hint)}>登录并选择工作区后，可管理该工作区的个人偏好。</p>
          )}
        </Card.Root>
      )}
      {section === 'privacy' && (
        <Card.Root>
          <Card.Header>
            <Card.Title>本地附件草稿</Card.Title>
            <Card.Description>
              未发送的附件保存在此浏览器。已发送的消息和附件由 Lody 会话保存。
            </Card.Description>
          </Card.Header>
          <p {...stylex.props(styles.hint)}>
            清理仅删除当前账户和工作区的本地附件草稿，不会删除云端资料或会话。
          </p>
          {confirmClear ? (
            <div {...stylex.props(styles.stack)}>
              <p {...stylex.props(styles.hint)}>清理后，需要重新选择这些未发送的文件。</p>
              <div {...stylex.props(styles.actions)}>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!scope) return;
                      await clearAttachmentScope(scope);
                      window.dispatchEvent(
                        new CustomEvent('lody:attachments-cleared', { detail: scope }),
                      );
                      setConfirmClear(false);
                      setStatus('本地附件草稿已清理。');
                    })
                  }
                >
                  确认清理附件草稿
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="small"
              variant="secondary"
              disabled={!scope || busy}
              onClick={() => setConfirmClear(true)}
            >
              清理附件草稿
            </Button>
          )}
        </Card.Root>
      )}
      {error && (
        <Alert.Root tone="danger">
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      )}
      {status && <output {...stylex.props(styles.hint)}>{status}</output>}
    </section>
  );
}
