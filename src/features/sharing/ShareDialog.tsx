import type { SessionShareManagementEntry } from '@lody-mobile/sdk';
import { createSessionShareUrl } from '@lody-mobile/sdk';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { Button, Input, Switch } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { Dialog } from '../../shared/ui/dialog';
import { useCopyFeedback } from '../../shared/ui/use-copy-feedback';
import type { PendingShare } from './journal';
import { readPendingReset, readPendingShare, readShareCredential, shareScope } from './journal';
import type { ShareClient } from './publisher';
import { captureShare, discardShare, publishShare, resetShareLink, revokeShare } from './publisher';
import { SharePreview } from './SharePreview';
import { shareSurface, styles } from './styles';
import { useShareAccess } from './use-share-access';

interface ShareDialogProps {
  client: ShareClient;
  sessionId: string;
  title: string;
  onClose: () => void;
  candidates?: readonly { id: string; title: string }[];
}
export function ShareDialog(props: ShareDialogProps) {
  return (
    <ShareDialogContent key={shareScope(props.client.accountKey, props.sessionId)} {...props} />
  );
}
function ShareDialogContent({
  client,
  sessionId,
  title,
  onClose,
  candidates = [],
}: ShareDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const access = useShareAccess(client.sharing.apiOrigin);
  const [previewReady, setPreviewReady] = useState(false);
  const [entry, setEntry] = useState<SessionShareManagementEntry | null>(null);
  const [pending, setPending] = useState<PendingShare | null>(null);
  const [selected, setSelected] = useState<string[]>([sessionId]);
  const [busy, setBusy] = useState('正在读取分享');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState('');
  const [progress, setProgress] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const { copied, error: copyError, copy } = useCopyFeedback();
  const scope = shareScope(client.accountKey, sessionId);
  const reload = async () => {
    const [nextEntry, nextPending, nextReset] = await Promise.all([
      client.sharing.getManagement(sessionId),
      readPendingShare(scope),
      readPendingReset(scope),
    ]);
    let nextLink = '';
    if (nextEntry?.status === 'active' && client.sharing.publicOrigin) {
      const credential = await readShareCredential(client.accountKey, nextEntry.shareId);
      if (credential?.version === nextEntry.credentialVersion)
        nextLink = createSessionShareUrl(
          nextEntry.shareId,
          credential.secret,
          client.sharing.publicOrigin,
        );
    }
    setEntry(nextEntry);
    setPending(nextPending);
    setResetPending(Boolean(nextReset));
    setLink(nextLink);
    setLoaded(true);
  };
  useEffect(() => {
    let live = true;
    void Promise.all([
      client.sharing.getManagement(sessionId),
      readPendingShare(scope),
      readPendingReset(scope),
    ])
      .then(async ([nextEntry, nextPending, nextReset]) => {
        const credential = nextEntry
          ? await readShareCredential(client.accountKey, nextEntry.shareId)
          : null;
        if (!live) return;
        setEntry(nextEntry);
        setPending(nextPending);
        setResetPending(Boolean(nextReset));
        if (
          nextEntry?.status === 'active' &&
          credential?.version === nextEntry.credentialVersion &&
          client.sharing.publicOrigin
        )
          setLink(
            createSessionShareUrl(
              nextEntry.shareId,
              credential.secret,
              client.sharing.publicOrigin,
            ),
          );
        if (nextEntry?.selectedSourceIds.length)
          setSelected([...new Set([sessionId, ...nextEntry.selectedSourceIds])]);
        setLoaded(true);
      })
      .catch((failure) => {
        if (live) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (live) setBusy('');
      });
    return () => {
      live = false;
    };
  }, [client, scope, sessionId]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setProgress('');
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      try {
        await reload();
      } catch {
        /* Keep the first failure and the last confirmed state. */
      }
    } finally {
      setBusy('');
    }
  };
  const ready = loaded && !busy;
  const configured = Boolean(client.sharing.publicOrigin && client.sharing.apiOrigin);
  const canCapture =
    configured &&
    ready &&
    !pending &&
    !resetPending &&
    (!entry || entry.status === 'revoked' || (entry.canManage && entry.status === 'active'));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Content
        closeLabel="关闭分享"
        ref={panelRef}
        initialFocus={panelRef}
        {...stylex.props(styles.panel)}
      >
        <Dialog.Header>
          <Dialog.Title>{title || '分享会话'}</Dialog.Title>
          <Dialog.Description>分享固定快照</Dialog.Description>
        </Dialog.Header>
        <div {...stylex.props(styles.body)}>
          {busy && <ActivityStatus busy>{progress || busy}</ActivityStatus>}
          {(error || copyError) && (
            <output
              role="alert"
              {...stylex.props(shareSurface.message, shareSurface.messageDestructive)}
            >
              {error || copyError}
            </output>
          )}
          {!configured && (
            <p {...stylex.props(shareSurface.message, shareSurface.messageWarning)}>
              此部署尚未配置公开分享地址，暂时不能发布或更新。已有分享仍可查询和撤销。
            </p>
          )}
          {configured && access.state === 'needed' && (
            <div {...stylex.props(styles.stack)}>
              <p {...stylex.props(styles.hint)}>
                发布和核验链接需要连接 {client.sharing.apiOrigin}
                。浏览器仅会请求这个服务地址的访问权限。
              </p>
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => void run('正在请求分享服务权限', access.request)}
              >
                允许连接分享服务
              </Button>
            </div>
          )}
          {pending ? (
            <>
              <p {...stylex.props(styles.hint)}>
                {pending.confirmed
                  ? '上次发布尚待确认，内容与恢复信息已保留。继续时会复用原部署与密钥。'
                  : '请检查以下公开内容，再确认发布。'}
              </p>
              <SharePreview
                key={pending.prepared.manifestHash}
                prepared={pending.prepared}
                onReady={setPreviewReady}
              />
              <p {...stylex.props(shareSurface.message, shareSurface.messageWarning)}>
                持有链接的任何人均可读取此快照，包括消息、工具输出和附带图片。
              </p>
            </>
          ) : (
            <>
              {entry?.status === 'active' ? (
                <>
                  <p {...stylex.props(styles.title)}>分享已发布</p>
                  {link ? (
                    <div {...stylex.props(styles.row)}>
                      <Input
                        readOnly
                        aria-label="公开分享链接"
                        value={link}
                        onFocus={(event) => event.target.select()}
                        {...stylex.props(styles.grow)}
                      />
                      <Button variant="secondary" onClick={() => void copy(link)}>
                        {copied ? '已复制' : '复制链接'}
                      </Button>
                    </div>
                  ) : (
                    <p {...stylex.props(styles.hint)}>
                      此设备没有与当前版本匹配的访问链接。原链接仍有效；可在创建链接的设备上复制，或撤销分享。
                    </p>
                  )}
                  <p {...stylex.props(styles.hint)}>
                    已发布的快照不会自动包含新消息。更新前可重新预览。
                  </p>
                </>
              ) : entry?.status === 'revoked' ? (
                <p {...stylex.props(styles.hint)}>分享已撤销，原链接不再提供内容。</p>
              ) : (
                <p {...stylex.props(styles.hint)}>先预览要公开的会话内容，再创建分享链接。</p>
              )}
              {entry?.status === 'draft' && (
                <p {...stylex.props(shareSurface.message, shareSurface.messageWarning)}>
                  云端存在未发布草稿，此设备没有对应的上传恢复信息。请先撤销草稿，再创建新的分享。
                </p>
              )}
              {!!candidates.filter((candidate) => candidate.id !== sessionId).length && (
                <section {...stylex.props(styles.stack)} aria-label="包含的关联会话">
                  <p {...stylex.props(styles.title)}>关联会话</p>
                  {candidates
                    .filter((candidate) => candidate.id !== sessionId)
                    .map((candidate) => (
                      <label key={candidate.id} {...stylex.props(styles.row)}>
                        <Switch
                          checked={selected.includes(candidate.id)}
                          disabled={!canCapture}
                          onCheckedChange={(checked) =>
                            setSelected((value) =>
                              checked
                                ? [...value, candidate.id]
                                : value.filter((id) => id !== candidate.id),
                            )
                          }
                        />
                        <span>{candidate.title}</span>
                      </label>
                    ))}
                </section>
              )}
            </>
          )}
          {(confirmReset || resetPending) && (
            <p {...stylex.props(shareSurface.message, shareSurface.messageWarning)}>
              {resetPending
                ? '链接重置结果尚待确认。继续时会使用已保留的密钥核验，旧链接可能已经失效。'
                : '重置链接会使原链接失效。新链接仅保存在当前设备，请妥善保留。'}
            </p>
          )}
          {confirmRevoke && (
            <p {...stylex.props(shareSurface.message, shareSurface.messageWarning)}>
              撤销后，持有原链接的人将无法继续读取。已被他人保存的副本不会被删除。
            </p>
          )}
        </div>
        <Dialog.Footer {...stylex.props(styles.footer)}>
          {entry?.canRevoke && entry.status !== 'revoked' && (
            <Button
              variant="ghost"
              disabled={!ready}
              onClick={() => {
                if (!confirmRevoke) {
                  setConfirmRevoke(true);
                  return;
                }
                void run('正在撤销分享', async () => {
                  await revokeShare(client, sessionId, entry);
                  setConfirmRevoke(false);
                });
              }}
            >
              {confirmRevoke ? '确认撤销分享' : '撤销分享'}
            </Button>
          )}
          {entry?.status === 'active' && entry.canManage && !pending && (
            <Button
              variant="secondary"
              disabled={!ready || !configured || access.state !== 'granted'}
              onClick={() => {
                if (!confirmReset && !resetPending) {
                  setConfirmReset(true);
                  return;
                }
                void run('正在重置分享链接', async () => {
                  await resetShareLink(client, sessionId, entry);
                  setConfirmReset(false);
                });
              }}
            >
              {resetPending ? '继续确认链接重置' : confirmReset ? '确认重置链接' : '重置链接'}
            </Button>
          )}
          {error && (
            <Button
              variant="secondary"
              disabled={!!busy}
              onClick={() => void run('正在读取分享', reload)}
            >
              重新读取
            </Button>
          )}
          {pending ? (
            <>
              {!pending.confirmed && (
                <Button
                  variant="secondary"
                  disabled={!ready}
                  onClick={() => void run('正在丢弃预览', () => discardShare(client, sessionId))}
                >
                  丢弃预览
                </Button>
              )}
              <Button
                disabled={
                  !ready ||
                  !previewReady ||
                  !configured ||
                  access.state !== 'granted' ||
                  pending.origin !== client.sharing.publicOrigin ||
                  pending.apiOrigin !== client.sharing.apiOrigin
                }
                onClick={() =>
                  void run('正在发布分享', async () => {
                    await publishShare(client, sessionId, (uploaded, total) =>
                      setProgress(`正在上传 ${total ? Math.round((uploaded / total) * 100) : 0}%`),
                    );
                  })
                }
              >
                {pending.confirmed ? '继续并确认发布' : '发布公开链接'}
              </Button>
            </>
          ) : (
            <Button
              disabled={!canCapture}
              onClick={() =>
                void run('正在准备预览', async () => {
                  await captureShare(client, sessionId, selected, entry);
                })
              }
            >
              {entry?.status === 'active' ? '预览更新内容' : '预览分享内容'}
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
