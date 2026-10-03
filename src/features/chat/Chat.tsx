import { text } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import { useAtomValue } from 'jotai';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { isExtension } from '../../shared/storage';
import { Alert, Button, Menu, Popover, Spinner, Tooltip } from '../../shared/ui';
import { composer } from '../../shared/ui/composer.stylex';
import { messageSurface } from '../../shared/ui/message.stylex';
import { PermissionModeMenu } from '../../shared/ui/PermissionModeMenu';
import { RunConfigMenu } from '../../shared/ui/RunConfigMenu';
import type { Conversation } from '../connection/client';
import { demoTarget, matchDemoProject } from '../connection/demo-directory';
import type { RunConfig } from '../connection/run-config';
import { normalizeRunConfig, reasoningLabel } from '../connection/run-config';
import { useLodyClient } from '../connection/use-client';
import { Conversations } from '../conversations/Conversations';
import { useConversations } from '../conversations/use-conversations';
import { capturePage, demoPage } from '../page-context/capture';
import { ContextStrip } from '../page-context/ContextStrip';
import type { PageContext } from '../page-context/model';
import { preferencesAtom } from '../preferences/state';
import { Composer } from './Composer';
import { MessageView } from './MessageView';
import { useChatUI } from './state';

const emptySessions: Conversation[] = [];

const styles = stylex.create({
  chat: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '0 16px 8px',
    flexShrink: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    scrollbarGutter: 'stable',
    overscrollBehavior: 'contain',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
    paddingBlock: 28,
    textAlign: 'center',
  },
  greeting: { margin: 0, fontSize: 32, lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.8px' },
  composer: { display: 'grid', gap: 8, padding: '0 12px 8px', flexShrink: 0 },
  disclosure: {
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    ':focus-visible': { outlineStyle: 'auto' },
  },
  primary: { display: 'flex' },
  shortcut: { color: composer.hint },
  hint: {
    fontSize: text.captionSize,
    lineHeight: text.captionLeading,
    margin: 0,
    textAlign: 'center',
    color: composer.hint,
  },
  jump: { alignSelf: 'center' },
  feedback: { display: 'grid', gap: 8, paddingInline: 16 },
});
const suggestions = [
  { label: '总结这篇网页', prompt: '总结这篇文章的要点', icon: 'page' },
  { label: '解释选中的内容', prompt: '解释选中内容', icon: 'chat' },
  { label: '一起规划下一步', prompt: '帮我制定下一步计划', icon: 'new' },
] as const;
export function Chat() {
  const client = useLodyClient();
  const query = useConversations(client);
  const ui = useChatUI(client.accountKey);
  const preferences = useAtomValue(preferencesAtom);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLElement>(null);
  const sessions = query.data ?? emptySessions;
  const session = sessions.find((item) => item.id === ui.selected);
  const last = session?.messages.at(-1);
  const running = last?.status === 'streaming';
  const failed = last?.status === 'failed';
  const real = !client.accountKey.startsWith('demo:');
  const acceptedConfig = session?.messages.findLast((item) => item.role === 'user')?.inputConfig;
  const runConfig = normalizeRunConfig(
    client.runModels,
    ui.draft.inputConfig ?? acceptedConfig,
    client.permissionModes,
  );
  const runModel = client.runModels.find((item) => item.value === runConfig?.modelId);
  const changeRunConfig = (patch: Partial<RunConfig>) => {
    if (!runConfig) return;
    ui.edit({
      inputConfig: normalizeRunConfig(
        client.runModels,
        { ...runConfig, ...patch },
        client.permissionModes,
      ),
    });
  };
  useEffect(() => {
    if (following && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [last?.text, session?.messages.length, session?.id, following]);
  useEffect(() => {
    if (ui.loaded && !ui.selected && sessions[0]) ui.select(sessions[0].id);
  }, [sessions, ui]);
  useEffect(() => {
    if (last?.id === ui.draft.operationId && last?.status === 'complete') {
      ui.edit({
        operationId: '',
        text: ui.draft.text === ui.draft.submittedText ? '' : ui.draft.text,
        contexts: ui.draft.text === ui.draft.submittedText ? [] : ui.draft.contexts,
      });
    }
  }, [last?.id, last?.status, ui]);
  const choose = (id: string) => {
    ui.select(id);
    setError('');
    setFollowing(true);
  };
  const attach = async (kind: 'page' | 'selection' | 'demo') => {
    if (ui.draft.contexts.length >= 3) {
      setError('最多附加 3 份网页资料。');
      return;
    }
    setCapturing(true);
    setError('');
    try {
      const context: PageContext = kind === 'demo' ? demoPage() : await capturePage(kind);
      ui.edit({ contexts: [...ui.draft.contexts, context] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取页面。');
    }
    setCapturing(false);
  };
  const send = async (retry = false) => {
    const retryMessage = retry ? session?.messages.at(-2) : undefined;
    const text = retryMessage?.role === 'user' ? retryMessage.text : ui.draft.text;
    const contexts = retryMessage?.role === 'user' ? retryMessage.contexts : ui.draft.contexts;
    if (running || sending || real || !text.trim()) return;
    setSending(true);
    setError('');
    setFollowing(true);
    try {
      let target = session;
      const project = preferences.autoProject ? matchDemoProject(contexts) : demoTarget.project;
      if (!target) {
        target = await client.create({ ...demoTarget, project });
        ui.select(target.id);
      }
      const operationId = crypto.randomUUID();
      await client.send({
        sessionId: target.id,
        operationId,
        text,
        contexts,
        fail: failNext,
        retry,
        inputConfig: retryMessage?.role === 'user' ? retryMessage.inputConfig : runConfig,
        ...(target.messages.length === 0 ? { project } : {}),
      });
      // New-session drafts move with the accepted command so reload and retry keep the input.
      ui.edit(
        {
          ...ui.draft,
          inputConfig: ui.draft.inputConfig ?? runConfig,
          operationId,
          submittedText: text,
        },
        target.id,
      );
      setFailNext(false);
      await query.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发送失败，草稿已保留。');
    }
    setSending(false);
  };
  const stop = async () => {
    try {
      await client.stop(ui.selected);
      await query.refetch();
    } catch {
      setError('停止失败。已收到的内容仍保留。');
    }
  };
  return (
    <section {...stylex.props(styles.chat)} aria-label="Lody 会话">
      <div {...stylex.props(styles.bar)}>
        <Conversations
          client={client}
          sessions={sessions}
          selected={ui.selected}
          workspaceName={preferences.displayName}
          onSelect={choose}
          onError={setError}
        />
      </div>
      {/* Keyboard focus makes the scrollable transcript usable without a pointer. */}
      <section
        ref={scrollRef}
        {...stylex.props(styles.scroll)}
        aria-label="消息记录"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onScroll={() => {
          const node = scrollRef.current;
          if (node) setFollowing(node.scrollHeight - node.clientHeight - node.scrollTop < 60);
        }}
      >
        {!session?.messages.length && (
          <div {...stylex.props(styles.empty)}>
            <h2 {...stylex.props(styles.greeting)}>一起做点什么？</h2>
          </div>
        )}
        <div {...stylex.props(messageSurface.column)}>
          {session?.messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}
        </div>
      </section>
      {!following && (
        <Button
          {...stylex.props(styles.jump)}
          variant="secondary"
          size="small"
          onClick={() => setFollowing(true)}
        >
          回到最新
        </Button>
      )}
      <div {...stylex.props(styles.feedback)}>
        {(error || ui.storageError || query.error) && (
          <Alert.Root tone="danger">
            <Alert.Description>
              {error || ui.storageError || query.error?.message}
            </Alert.Description>
            <Alert.Actions>
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setError('');
                  void query.refetch();
                }}
              >
                重试读取
              </Button>
            </Alert.Actions>
          </Alert.Root>
        )}
        {failed && (
          <Alert.Root tone="danger">
            <Alert.Title>演示发送失败</Alert.Title>
            <Alert.Description>已收到的内容与草稿已保留。</Alert.Description>
            <Alert.Actions>
              <Button size="small" onClick={() => void send(true)} disabled={sending}>
                重试发送
              </Button>
            </Alert.Actions>
          </Alert.Root>
        )}
      </div>
      <form
        {...stylex.props(styles.composer)}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Composer
          value={ui.draft.text}
          disabled={real || !ui.loaded}
          onChange={(text) => ui.edit({ text })}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void send();
            }
          }}
          attachments={
            <ContextStrip
              contexts={ui.draft.contexts}
              remove={(id) =>
                ui.edit({ contexts: ui.draft.contexts.filter((item) => item.id !== id) })
              }
            />
          }
          attachmentAction={
            <Menu.Root>
              <Menu.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="small"
                    icon
                    disabled={capturing || real}
                    aria-label="附加上下文"
                  />
                }
              >
                {capturing ? <Spinner size="small" label={null} /> : <Icon name="plus" size={16} />}
              </Menu.Trigger>
              <Menu.Content
                side="top"
                align="start"
                finalFocus={() =>
                  document.querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]')
                }
              >
                <Menu.Item
                  icon={<Icon name="page" size="100%" />}
                  onClick={() => void attach('page')}
                >
                  附加当前页面
                </Menu.Item>
                <Menu.Item
                  icon={<Icon name="chat" size="100%" />}
                  onClick={() => void attach('selection')}
                >
                  附加选中文字
                </Menu.Item>
                {!isExtension() && (
                  <Menu.Item onClick={() => void attach('demo')}>附加演示页面</Menu.Item>
                )}
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>快捷指令</Menu.GroupLabel>
                  {suggestions.map((suggestion) => (
                    <Menu.Item
                      key={suggestion.prompt}
                      icon={<Icon name={suggestion.icon} size="100%" />}
                      onClick={() => ui.edit({ text: suggestion.prompt })}
                    >
                      {suggestion.label}
                    </Menu.Item>
                  ))}
                </Menu.Group>
                {!real && (
                  <Menu.Item onClick={() => setFailNext(true)}>演示：下一次发送失败</Menu.Item>
                )}
              </Menu.Content>
            </Menu.Root>
          }
          configuration={
            <>
              <RunConfigMenu
                disabled={sending || real || !ui.loaded}
                agentLocked
                agentLabel="Codex"
                models={client.runModels}
                modelId={runConfig?.modelId ?? ''}
                onModelChange={(modelId) => changeRunConfig({ modelId })}
                reasoningOptions={
                  runModel?.reasoningEfforts.map((value) => ({
                    value,
                    label: reasoningLabel(value),
                  })) ?? []
                }
                reasoningEffort={runConfig?.reasoningEffort ?? ''}
                onReasoningChange={(reasoningEffort) => changeRunConfig({ reasoningEffort })}
                planMode={runModel?.planMode ? runConfig?.planMode : undefined}
                onPlanChange={(planMode) => changeRunConfig({ planMode })}
                fastMode={runModel?.fastMode ? runConfig?.fastMode : undefined}
                onFastChange={(fastMode) => changeRunConfig({ fastMode })}
              />
              <PermissionModeMenu
                disabled={sending || real || !ui.loaded}
                options={client.permissionModes}
                value={runConfig?.modeId ?? 'agent-auto-review'}
                onChange={(modeId) => changeRunConfig({ modeId })}
              />
            </>
          }
          primaryAction={
            <m.div {...stylex.props(styles.primary)} tabIndex={-1} whileTap={{ scale: 0.96 }}>
              <Tooltip.Root>
                <Tooltip.Trigger
                  render={
                    <Button
                      type={running ? 'button' : 'submit'}
                      size="small"
                      shape="pill"
                      icon
                      disabled={real || sending || (!running && !ui.draft.text.trim())}
                      onClick={running ? () => void stop() : undefined}
                      aria-label={running ? '停止生成' : '发送消息'}
                    />
                  }
                >
                  {sending ? (
                    <Spinner size="small" label={null} />
                  ) : (
                    <Icon name={running ? 'stop' : 'send'} size={16} />
                  )}
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {running ? '保留已收到的内容' : 'Enter 发送 · Shift+Enter 换行'}
                </Tooltip.Content>
              </Tooltip.Root>
            </m.div>
          }
        />
        <p {...stylex.props(styles.hint)}>
          {failNext ? (
            '演示：本次发送将模拟失败，可重试。'
          ) : (
            <>
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <button
                      type="button"
                      aria-label="网页资料说明"
                      {...stylex.props(styles.disclosure)}
                    />
                  }
                >
                  仅使用主动附加的资料
                </Popover.Trigger>
                <Popover.Content side="top" align="start">
                  <Popover.Header>
                    <Popover.Title>网页资料只读</Popover.Title>
                    <Popover.Description>
                      只读取你主动附加的正文或选中文字。网页内容不授予 Agent 工具权限。
                    </Popover.Description>
                  </Popover.Header>
                  <p {...stylex.props(styles.hint)}>
                    {preferences.displayName} · 演示机器 · 在线
                    <br />
                    {session?.target.project.kind === 'github'
                      ? session.target.project.repo
                      : '独立会话'}
                  </p>
                </Popover.Content>
              </Popover.Root>
              <span aria-hidden="true"> · </span>
              <span {...stylex.props(styles.shortcut)}>Enter 发送</span>
            </>
          )}
        </p>
      </form>
      <output className="sr-only">
        {running
          ? 'Agent 正在生成'
          : failed
            ? '发送失败'
            : last?.status === 'stopped'
              ? '已停止生成'
              : last?.status === 'complete'
                ? '回复已完成'
                : ''}
      </output>
    </section>
  );
}
