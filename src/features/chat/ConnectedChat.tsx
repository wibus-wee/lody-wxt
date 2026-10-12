import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as v from 'valibot';

import { productConfig } from '../../app/product-config';
import { Icon } from '../../shared/icons/Icon';
import { Alert, Button, Input, Menu, Popover, Spinner, Tooltip } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { readConversationContent } from '../../shared/ui/conversation/content';
import { formatMessageTime } from '../../shared/ui/format-message-time';
import { PermissionModeMenu } from '../../shared/ui/PermissionModeMenu';
import { RunConfigMenu } from '../../shared/ui/RunConfigMenu';
import { AccountPage } from '../account/AccountPage';
import { useAccount } from '../account/useAccount';
import { AutomationsPanel } from '../automations/AutomationsPanel';
import type { LodyClient, PageContext, RunConfig } from '../connection/client';
import {
  configurationCategory,
  configurationValuesForModel,
  defaultRunSelection,
  inheritedMcpSelection,
} from '../connection/run-configuration';
import { grantGatewayAccess } from '../connection/state';
import { useLodyClient } from '../connection/use-client';
import { blockSchema } from '../conversations/admission';
import {
  notifySubmittedTurn,
  registerForegroundSession,
  takeNotificationNavigation,
} from '../notifications/client';
import { capturePage } from '../page-context/capture';
import { ContextStrip } from '../page-context/ContextStrip';
import { PageContextMenu } from '../page-context/PageContextMenu';
import { TabContextPicker } from '../page-context/TabContextPicker';
import { personalMemoryPrompt, subscribePersonalMemory } from '../privacy/memory';
import { ShareDialog } from '../sharing/ShareDialog';
import { DictationDialog } from '../voice/DictationDialog';
import { dictationAvailable } from '../voice/recognition';
import { Chat } from './Chat';
import { ChatHeader } from './ChatHeader';
import { ChatHistory } from './ChatHistory';
import { ComposerContextBar } from './ComposerContextBar';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { messageAttachments, sameAttachments } from './conversation-actions';
import { ConversationTurnActions } from './ConversationTurnActions';
import { DraftAttachments } from './DraftAttachments';
import { McpPicker } from './McpPicker';
import { COMPOSER_MAX_LENGTH, editMentionRanges, expandComposerMentions } from './mentions/core';
import { createComposerMentionSource } from './mentions/source';
import type { ComposerMentionRange } from './mentions/types';
import type { ChatMessage } from './MessageView';
import { contextSchema, matchesContextInput } from './real-adapter';
import { readResume, resumeKey, touchResume, writeResume } from './session-resume';
import { SkillsPicker } from './SkillsPicker';
import { TargetPicker } from './TargetPicker';
import { useAttachmentDrafts } from './use-attachment-drafts';

const styles = stylex.create({
  setup: {
    padding: '24px 20px',
    display: 'grid',
    gap: 20,
    overflowY: 'auto',
    alignContent: 'center',
    flex: 1,
  },
  welcome: { textAlign: 'center' },
  heading: { fontSize: 24, fontWeight: 600, margin: '0 0 8px', letterSpacing: '-0.6px' },
  description: { margin: 0, fontSize: 14 },
  diagnostic: { overflowWrap: 'anywhere', minWidth: 0, fontSize: 12 },
  meta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    minWidth: 0,
  },
  title: {
    margin: 0,
    fontSize: 12,
    fontWeight: 400,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
const draftSchema = v.object({
  text: v.string(),
  contexts: v.array(contextSchema),
  currentPage: v.exactOptional(v.boolean()),
  mentions: v.exactOptional(
    v.array(
      v.object({
        start: v.pipe(v.number(), v.integer(), v.minValue(0)),
        end: v.pipe(v.number(), v.integer(), v.minValue(0)),
        text: v.string(),
        expansion: v.string(),
        scope: v.exactOptional(v.string()),
      }),
    ),
  ),
});
const permissionSchema = v.object({
  requestId: v.string(),
  options: v.array(v.object({ optionId: v.string(), name: v.optional(v.string()) })),
  outcome: v.optional(v.unknown()),
});

export function ConnectedChat({ active = true }: { active?: boolean }) {
  const client = useLodyClient(productConfig.convexOrigin, active);
  const account = useAccount();
  if (!client && !active) return null;
  if (!client)
    return (
      <>
        <ChatHeader />
        <section {...stylex.props(styles.setup)}>
          <div {...stylex.props(styles.welcome)}>
            <h2 {...stylex.props(styles.heading)}>让 Lody 陪你浏览</h2>
            <p {...stylex.props(styles.description)}>读懂网页，理清思路，随时问一句。</p>
          </div>
          <AccountPage />
        </section>
      </>
    );
  return (
    <ClientChat
      key={client.accountKey}
      client={client}
      workspaceId={account.workspace?.id ?? ''}
      accountId={account.account?.user.id ?? ''}
      active={active}
    />
  );
}

function ClientChat({
  client,
  workspaceId,
  accountId,
  active,
}: {
  client: LodyClient;
  workspaceId: string;
  accountId: string;
  active: boolean;
}) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [targetOpen, setTargetOpen] = useState(false);
  const [automations, setAutomations] = useState(false);
  const [dictation, setDictation] = useState(false);
  const [skills, setSkills] = useState(false);
  const [connectors, setConnectors] = useState(false);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [tabs, setTabs] = useState(false);
  const selectionKey = resumeKey(client.accountKey);
  const [initialSelection] = useState(() => {
    try {
      return { id: readResume(selectionKey), error: '' };
    } catch (reason) {
      return { id: '', error: reason instanceof Error ? reason.message : '无法恢复当前会话。' };
    }
  });
  const [selected, setSelected] = useState(initialSelection.id);
  const selectionGenerationRef = useRef(0);
  const restoreSelectionRef = useRef(initialSelection.id);
  const actionRef = useRef(false);
  const [error, setError] = useState(initialSelection.error);
  const [notificationError, setNotificationError] = useState('');
  const watchSubmittedTurn = (sessionId: string, turnId: string) => {
    void notifySubmittedTurn(sessionId, turnId, client.accountKey).catch((reason: Error) => {
      setNotificationError(`消息已送达，任务通知未能登记：${reason.message}`);
    });
  };
  const selectConversation = useCallback(
    (id: string) => {
      selectionGenerationRef.current += 1;
      restoreSelectionRef.current = '';
      setSelected(id);
      try {
        writeResume(selectionKey, id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法保存当前会话。');
      }
    },
    [selectionKey],
  );
  useEffect(() => {
    if (!selected || !active) return;
    // Refresh while visible and stamp the actual close when pagehide is delivered.
    // A crash falls back to the last heartbeat, without resurrecting a cleared selection.
    const retain = () => {
      try {
        touchResume(selectionKey, selected);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法保存当前会话。');
      }
    };
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') retain();
    }, 15_000);
    window.addEventListener('pagehide', retain);
    document.addEventListener('visibilitychange', retain);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', retain);
      document.removeEventListener('visibilitychange', retain);
    };
  }, [active, selected, selectionKey]);
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (operation: () => Promise<void>) => {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败。');
    } finally {
      actionRef.current = false;
      setBusy(false);
    }
  }, []);
  const navigationRef = useRef<Promise<string | null> | null>(null);
  useEffect(
    () =>
      registerForegroundSession(
        active && !automations && !sharing && !diagnostics ? selected || null : null,
      ),
    [active, automations, diagnostics, selected, sharing],
  );
  useEffect(() => {
    if (!active || snapshot.status !== 'connected') return;
    let live = true;
    const generation = selectionGenerationRef.current;
    void Promise.resolve().then(() => {
      if (!live || generation !== selectionGenerationRef.current) return;
      return act(async () => {
        try {
          await client.connect();
          if (!live || generation !== selectionGenerationRef.current) return;
          navigationRef.current ??= takeNotificationNavigation();
          const notificationId = await navigationRef.current;
          if (!live || generation !== selectionGenerationRef.current) return;
          const id = notificationId || restoreSelectionRef.current;
          if (!id) return;
          restoreSelectionRef.current = '';
          navigationRef.current = Promise.resolve(null);
          await client.open(id);
          if (live && generation === selectionGenerationRef.current) selectConversation(id);
        } catch (reason) {
          if (live && generation === selectionGenerationRef.current) throw reason;
        }
      });
    });
    return () => {
      live = false;
    };
  }, [act, active, client, selectConversation, snapshot.status]);
  const [memory, setMemory] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const read = () => {
      if (!active) return;
      try {
        setMemory(personalMemoryPrompt(client.accountKey));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法读取个人偏好。');
      }
    };
    queueMicrotask(read);
    const unwatch = subscribePersonalMemory(client.accountKey, read);
    return () => {
      active = false;
      unwatch();
    };
  }, [client.accountKey]);
  const [config, setConfig] = useState<RunConfig>();
  const draftKey = `lody:chat-draft:${client.accountKey}:${selected || 'new'}`;
  const binary = useAttachmentDrafts(draftKey, client.accountKey);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentDraftKeyRef = useRef(draftKey);
  useEffect(() => {
    currentDraftKeyRef.current = draftKey;
    return () => {
      currentDraftKeyRef.current = '';
    };
  }, [draftKey]);
  const [draft, setDraft] = useState<{
    text: string;
    contexts: PageContext[];
    currentPage?: boolean;
    mentions?: ComposerMentionRange[];
  }>({
    text: '',
    contexts: [],
  });
  const [loaded, setLoaded] = useState('');
  const updateDraftText = (
    text: string,
    mentions: readonly ComposerMentionRange[] = [],
    context?: PageContext,
  ) => {
    if (currentDraftKeyRef.current !== draftKey) throw new Error('对话已改变，请重新选择。');
    if (text.length > COMPOSER_MAX_LENGTH)
      throw new Error('消息最多 16,000 字符，请缩短内容后重试。原草稿已保留。');
    if (
      context &&
      draft.contexts.length >= 8 &&
      !draft.contexts.some((item) => item.id === context.id)
    )
      throw new Error('网页资料已达上限，请先移除一项。');
    setDraft((current) => ({
      ...current,
      text,
      mentions: [...editMentionRanges(current.text, text, current.mentions), ...mentions],
      contexts: context
        ? [...current.contexts.filter((item) => item.id !== context.id), context]
        : current.contexts,
    }));
  };
  const mentionSource = useMemo(
    () =>
      createComposerMentionSource({
        client,
        sessionId: selected,
        target: snapshot.target,
      }),
    [client, selected, snapshot.target],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const parsed = v.parse(
          draftSchema,
          JSON.parse(localStorage.getItem(draftKey) ?? '{"text":"","contexts":[]}'),
        );
        setDraft(parsed);
        setLoaded(draftKey);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '无法读取草稿。');
      }
    });
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (loaded !== draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch (reason) {
      queueMicrotask(() => setError(reason instanceof Error ? reason.message : '无法保存草稿。'));
    }
  }, [draft, draftKey, loaded]);
  const pendingComposerFocusRef = useRef<string | null>(null);
  useEffect(() => {
    pendingComposerFocusRef.current = active ? draftKey : null;
  }, [active, draftKey]);
  useEffect(() => {
    if (!active || snapshot.status !== 'connected' || busy || snapshot.busy || loaded !== draftKey)
      return;
    let live = true;
    queueMicrotask(() => {
      if (!live || actionRef.current || pendingComposerFocusRef.current !== draftKey) return;
      const input = document.querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]');
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      if (document.activeElement === input) pendingComposerFocusRef.current = null;
    });
    return () => {
      live = false;
    };
  }, [active, busy, snapshot.busy, snapshot.status, loaded, draftKey]);
  const session = snapshot.conversations.find((row) => row.id === selected);
  const running = session?.messages.some(
    (message) => message.role === 'agent' && message.status === 'streaming',
  );
  const latest = session?.messages.at(-1);
  const waitingForReply =
    latest?.role === 'user' && new Set(['pending', 'seen']).has(latest.turn.status ?? '');
  const { modelId, modeId } = defaultRunSelection(snapshot, config);
  const model = snapshot.runModels.find((row) => row.value === modelId);
  const configOptions = snapshot.modelConfigOptions?.[modelId] ?? snapshot.configOptions ?? [];
  const mcpServerIds = inheritedMcpSelection(session, config?.mcpServerIds);
  const runConfig: RunConfig = {
    ...(modelId ? { modelId } : {}),
    ...(modeId ? { modeId } : {}),
    ...(mcpServerIds !== undefined ? { mcpServerIds } : {}),
    reasoningEffort: config?.reasoningEffort ?? '',
    planMode: false,
    fastMode: false,
    configOptionValues: configurationValuesForModel(
      configOptions,
      config?.configOptionValues,
      modelId,
      modeId,
    ),
  };

  const chooseAgent = (id: string) =>
    void act(async () => {
      await client.selectTarget({
        workspaceId,
        machineId: snapshot.selectedMachineId ?? snapshot.target?.machineId ?? '',
        agentConfigId: id,
        project: { kind: 'chat' },
      });
      setConfig(undefined);
    });
  const changeOption = (id: string, value: string | boolean) =>
    setConfig({
      ...runConfig,
      ...(snapshot.runModels.length &&
      configurationCategory(configOptions.find((option) => option.id === id) ?? { id }) === 'model'
        ? { modelId: v.parse(v.string(), value) }
        : {}),
      ...(snapshot.permissionModes.length &&
      configurationCategory(configOptions.find((option) => option.id === id) ?? { id }) === 'mode'
        ? { modeId: v.parse(v.string(), value) }
        : {}),
      configOptionValues: { ...runConfig.configOptionValues, [id]: value },
    });
  const open = (id: string) =>
    void act(async () => {
      selectionGenerationRef.current += 1;
      restoreSelectionRef.current = '';
      await client.open(id);
      selectConversation(id);
      setConfig(undefined);
    });
  const send = (delivery: 'send' | 'queue' | 'steer' = 'send') =>
    void act(async () => {
      if (
        (!draft.text.trim() && !binary.items.length) ||
        (running && delivery === 'send') ||
        loaded !== draftKey ||
        !binary.loaded ||
        snapshot.status !== 'connected'
      )
        return;
      if (selected && !session)
        throw new Error('当前会话尚未恢复或已不可用。草稿已保留，请重新读取或新建会话。');
      if (
        snapshot.admission &&
        !(
          snapshot.admission.phase === 'awaiting-first-turn' &&
          session?.id === snapshot.admission.sessionId
        )
      )
        throw new Error('请先确认上一条消息的发送结果。');
      if (!snapshot.target) {
        setTargetOpen(true);
        return;
      }
      if (snapshot.runConfigurationReady === false)
        throw new Error('助手配置尚未就绪，请刷新助手配置。');
      const submitted = draft;
      const context = submitted.currentPage ? await capturePage('page') : undefined;
      const contexts = context
        ? [...submitted.contexts.filter((item) => item.id !== context.id), context]
        : submitted.contexts;
      if (contexts.length > 8)
        throw new Error('网页资料已达上限，请先移除一项或关闭发送时读取当前页面。');
      if (context) setDraft((current) => ({ ...current, contexts, currentPage: false }));
      const submittedFiles = binary.items.map((item) => item.id);
      const prepared: {
        operationId?: string;
        reservedSessionId?: string;
        attachments?: readonly import('../connection/client').ChatAttachment[];
      } = submittedFiles.length ? await binary.prepare(client.uploadAttachment, session?.id) : {};
      const input = {
        operationId: crypto.randomUUID(),
        ...prepared,
        text:
          (submitted.text.trim()
            ? expandComposerMentions(submitted.text, submitted.mentions, mentionSource.scopeKey)
            : '请查看这些附件，帮我分析其中的内容。') +
          (memory ? `\n\n本次采用的个人偏好：\n${memory}` : ''),
        contexts,
        inputConfig: runConfig,
      };
      let target = session;
      if (!target && prepared.reservedSessionId)
        target = snapshot.conversations.find((row) => row.id === prepared.reservedSessionId);
      const delivered =
        target && submittedFiles.length
          ? (await client.readConversation(target.id)).messages.find(
              (row) => row.id === input.operationId,
            )
          : undefined;
      if (delivered) {
        if (
          !matchesContextInput(delivered.turn.inputConfig, input.text, contexts) ||
          !sameAttachments(messageAttachments(delivered), prepared.attachments ?? [])
        )
          throw new Error('这份附件草稿的原消息已送达。请先移除已发送附件，再填写新的消息。');
      } else if (target) {
        const message = { ...input, sessionId: target.id };
        if (delivery === 'steer') {
          const active = target.messages.findLast(
            (row) => row.role === 'agent' && row.status === 'streaming',
          );
          if (!snapshot.canSteer || !active) throw new Error('当前任务不支持补充指令。');
          await client.steer(message, active.id);
        } else if (delivery === 'queue') await client.queue(message);
        else await client.send(message);
      } else {
        if (!snapshot.target) throw new Error('选择机器与 Agent。');
        target = await client.start({ ...snapshot.target, project: { kind: 'chat' } }, input);
        await client.open(target.id);
      }
      if (!target) throw new Error('无法确认目标会话，草稿已保留。');
      if (delivery === 'send') watchSubmittedTurn(target.id, input.operationId);
      if (submittedFiles.length) await binary.clear(submittedFiles);
      setDraft((current) =>
        current.text === submitted.text ? { text: '', contexts: [] } : current,
      );
      localStorage.removeItem(draftKey);
      localStorage.removeItem(`lody:chat-draft:${client.accountKey}:${target.id}`);
      selectConversation(target.id);
    });
  const addFiles = (files: File[]) => void act(() => binary.add(files));
  const permissions = session?.messages.flatMap((message) =>
    message.activities.flatMap((activity) => {
      if (activity.permissionRequest === undefined) return [];
      const parsed = v.safeParse(permissionSchema, activity.permissionRequest);
      if (!parsed.success)
        return [
          <Alert.Root key={activity.id} tone="warning">
            <Alert.Description>
              权限请求格式无法识别。请在高级工作区检查原始活动。
            </Alert.Description>
          </Alert.Root>,
        ];
      if (parsed.output.outcome !== undefined) return [];
      return [
        <Alert.Root key={activity.id} tone="warning">
          <Alert.Title>{activity.title}</Alert.Title>
          <Alert.Actions>
            {parsed.output.options.map((option) => (
              <Button
                key={option.optionId}
                disabled={busy}
                size="small"
                onClick={() =>
                  void act(() =>
                    client.respondPermission(
                      session.id,
                      message.id,
                      parsed.output.requestId,
                      option.optionId,
                    ),
                  )
                }
              >
                {option.name ?? option.optionId}
              </Button>
            ))}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  client.respondPermission(session.id, message.id, parsed.output.requestId, null),
                )
              }
            >
              取消
            </Button>
          </Alert.Actions>
        </Alert.Root>,
      ];
    }),
  );
  const messages: ChatMessage[] = (session?.messages ?? [])
    .filter((message) => message.role !== 'system')
    .map((message, index, visible) => ({
      id: message.id,
      role: message.role === 'user' ? 'user' : 'agent',
      text: message.text,
      status: message.status,
      timestamp: formatMessageTime(message.role === 'user' ? message.createdAt : message.endedAt),
      content: readConversationContent([
        ...(message.turn.items ?? []),
        ...(message.role === 'user'
          ? (message.turn.inputConfig?.inputBlocks ?? []).filter((block) => block.type !== 'text')
          : []),
      ]),
      contentActions: {
        loadAttachment: (attachment) => {
          const block = v.parse(blockSchema, attachment);
          if (block.type === 'text') throw new Error('无效的附件引用。');
          return client.downloadAttachment(selected, block);
        },
        onCommand: (command) => updateDraftText(command),
        onOpenSubagent: open,
      },
      actions: (
        <ConversationTurnActions
          client={client}
          sessionId={selected}
          message={message}
          precedingUser={visible.slice(0, index).findLast((item) => item.role === 'user')}
          canFork={snapshot.canFork === true}
          currentConfig={runConfig}
          disabled={busy || !!running || !!waitingForReply || !!snapshot.admission}
          onOpen={selectConversation}
        />
      ),
      attachments: <ContextStrip contexts={message.contexts} layout="message" />,
      configuration:
        message.inputConfig?.modelId || message.inputConfig?.modeId ? (
          <span>
            {[message.inputConfig.modelId, message.inputConfig.modeId].filter(Boolean).join(' · ')}
          </span>
        ) : null,
    }));
  const disabled =
    busy ||
    snapshot.busy ||
    snapshot.status !== 'connected' ||
    loaded !== draftKey ||
    !binary.loaded;
  const blockedDelivery = Boolean(
    snapshot.admission &&
    !(
      snapshot.admission.phase === 'awaiting-first-turn' &&
      session?.id === snapshot.admission.sessionId
    ),
  );
  if (automations)
    return (
      <AutomationsPanel
        initialPrompt={draft.text}
        client={client}
        accountId={accountId}
        workspaceId={workspaceId}
        target={snapshot.target}
        onClose={() => setAutomations(false)}
        onOpenSession={(id) => {
          setAutomations(false);
          open(id);
        }}
        onUseWorkflow={async (workflow) => {
          const nextText = draft.text.trim()
            ? `${draft.text}\n\n${workflow.prompt}`
            : workflow.prompt;
          if (nextText.length > COMPOSER_MAX_LENGTH)
            throw new Error(
              '加入后超过消息的 16,000 字符上限，请缩短快捷指令后重试。原草稿已保留。',
            );
          const context = workflow.includeCurrentPage ? await capturePage('page') : undefined;
          if (currentDraftKeyRef.current !== draftKey)
            throw new Error('对话已改变，请重新选择快捷指令。');
          if (context && draft.contexts.length >= 8)
            throw new Error('网页资料已满，请返回草稿移除资料后继续。');
          setDraft((current) => {
            const prefix = current.text.trim() ? `${current.text}\n\n` : '';
            const text = prefix + workflow.prompt;
            return {
              ...current,
              text,
              mentions: [
                ...editMentionRanges(current.text, text, current.mentions),
                ...(workflow.mentions ?? []).map((range) => ({
                  ...range,
                  start: range.start + prefix.length,
                  end: range.end + prefix.length,
                  scope: mentionSource.scopeKey,
                })),
              ],
              contexts: context
                ? [...current.contexts.filter((item) => item.id !== context.id), context]
                : current.contexts,
            };
          });
          setAutomations(false);
        }}
        targetControl={
          <TargetPicker
            snapshot={snapshot}
            open={targetOpen}
            onOpenChange={setTargetOpen}
            busy={busy}
            locked={false}
            onMachine={(machineId) =>
              void act(async () => {
                await client.selectTarget({
                  workspaceId,
                  machineId,
                  agentConfigId: '',
                  project: { kind: 'chat' },
                });
                setConfig(undefined);
              })
            }
            onAgent={chooseAgent}
          />
        }
      />
    );
  return (
    <Chat
      key={selected}
      messages={messages}
      scrollKey={`${client.accountKey}:${selected || 'new'}`}
      onSubmit={() => send()}
      conversationControl={
        <ChatHeader>
          <ChatHistory
            conversations={snapshot.conversations}
            selected={selected}
            disabled={busy || snapshot.status !== 'connected'}
            onOpen={open}
          />
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Button
                  variant="ghost"
                  size="small"
                  icon
                  aria-label="快捷指令与定时任务"
                  disabled={busy}
                  onClick={() => setAutomations(true)}
                />
              }
            >
              <Icon name="plan" size={18} />
            </Tooltip.Trigger>
            <Tooltip.Content>快捷指令与定时任务</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Button
                  variant="ghost"
                  size="small"
                  icon
                  aria-label="新建会话"
                  disabled={busy}
                  onClick={() => {
                    if (actionRef.current) return;
                    setError('');
                    selectConversation('');
                    setConfig(undefined);
                    document
                      .querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]')
                      ?.focus();
                  }}
                />
              }
            >
              <Icon name="new" size={18} />
            </Tooltip.Trigger>
            <Tooltip.Content>新对话</Tooltip.Content>
          </Tooltip.Root>
        </ChatHeader>
      }
      title={session?.title}
      onSuggestion={(kind) =>
        void act(async () => {
          const prompt = {
            summary: '帮我总结这个网页的重点。',
            selection: '帮我解释这段文字。',
            question: '帮我梳理一下思路：',
            translate: '请把所选文字翻译成中文，保留专有名词，并附上原文以便对照。',
            reply: '请根据这个网页的内容，帮我起草一段回复。先给我可编辑的文本。',
          }[kind];
          if (kind !== 'question') {
            const context = await capturePage(
              new Set(['selection', 'translate']).has(kind) ? 'selection' : 'page',
            );
            if (
              draft.contexts.length >= 8 &&
              !draft.contexts.some((item) => item.id === context.id)
            )
              throw new Error('网页资料已达上限，请先移除一项。');
            setDraft((current) => ({
              ...current,
              text: current.text.trim() ? `${current.text}\n\n${prompt}` : prompt,
              contexts: [...current.contexts.filter((item) => item.id !== context.id), context],
            }));
          } else
            setDraft((current) => ({
              ...current,
              text: current.text.trim() ? `${current.text}\n\n${prompt}` : prompt,
            }));
          document.querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]')?.focus();
        })
      }
      suggestionsDisabled={busy || loaded !== draftKey}
      status={
        !error &&
        !snapshot.error &&
        (!snapshot.admission || snapshot.busy) &&
        (snapshot.status !== 'connected' ? (
          <ActivityStatus busy={snapshot.status === 'connecting'}>
            {snapshot.status === 'connecting' ? '连接工作区' : '工作区未连接'}
          </ActivityStatus>
        ) : snapshot.busy ? (
          <ActivityStatus busy>发送中</ActivityStatus>
        ) : snapshot.target && snapshot.runConfigurationReady === false ? (
          <ActivityStatus
            busy
            action={
              <Button
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => void act(() => client.refreshCapabilities())}
              >
                刷新助手配置
              </Button>
            }
          >
            获取助手配置
          </ActivityStatus>
        ) : waitingForReply ? (
          <ActivityStatus busy>等待助手回复</ActivityStatus>
        ) : null)
      }
      feedback={
        <>
          {notificationError && <ActivityStatus>{notificationError}</ActivityStatus>}
          {diagnostics && (
            <ConnectionDiagnostics
              snapshot={snapshot}
              sessionId={selected}
              onClose={() => setDiagnostics(false)}
            />
          )}
          {sharing && (
            <ShareDialog
              client={client}
              sessionId={sharing.id}
              title={sharing.title}
              candidates={snapshot.conversations.map(({ id, title }) => ({ id, title }))}
              onClose={() => setSharing(null)}
            />
          )}
          {tabs && (
            <TabContextPicker
              maxRemaining={8 - draft.contexts.length}
              onClose={() => setTabs(false)}
              onAdd={(context) => {
                if (currentDraftKeyRef.current !== draftKey)
                  throw new Error('对话已改变，请重新附加资料。');
                setDraft((current) => ({
                  ...current,
                  contexts: [
                    ...current.contexts.filter((row) => row.id !== context.id),
                    context,
                  ].slice(0, 8),
                }));
              }}
            />
          )}
          {connectors && (
            <McpPicker
              client={client}
              selected={runConfig.mcpServerIds}
              onClose={() => setConnectors(false)}
              onApply={(mcpServerIds) => setConfig({ ...runConfig, mcpServerIds })}
            />
          )}
          {skills && (
            <SkillsPicker
              key={snapshot.target?.agentConfigId}
              client={client}
              onClose={() => setSkills(false)}
              onUse={(prompt) => updateDraftText(prompt + draft.text)}
            />
          )}
          {dictation && (
            <DictationDialog
              onClose={() => setDictation(false)}
              onInsert={(text) =>
                setDraft((current) => ({
                  ...current,
                  text: [current.text, text].filter(Boolean).join('\n').slice(0, 16000),
                }))
              }
            />
          )}
          {binary.error && (
            <Alert.Root tone="danger">
              <Alert.Description>{binary.error}</Alert.Description>
            </Alert.Root>
          )}
          {(error || snapshot.error) && !snapshot.admission && (
            <Alert.Root tone="danger">
              <Alert.Description {...stylex.props(styles.diagnostic)}>
                {error || snapshot.error}
              </Alert.Description>
              <Alert.Actions>
                <Button
                  onClick={() =>
                    void act(async () => {
                      if (snapshot.status !== 'connected') await client.connect();
                      else {
                        if (selected) await client.open(selected);
                        await client.list();
                      }
                    })
                  }
                >
                  重新读取
                </Button>
              </Alert.Actions>
            </Alert.Root>
          )}
          {snapshot.admission && !snapshot.busy && (
            <Alert.Root tone="warning">
              <Alert.Description>
                {snapshot.admission.phase === 'metadata-unconfirmed'
                  ? '会话创建结果待确认，草稿已保留。'
                  : snapshot.admission.phase === 'awaiting-first-turn'
                    ? '对话已准备好，可以继续发送草稿。'
                    : '发送结果待确认，草稿已保留。'}
              </Alert.Description>
              {(error || snapshot.error) && (
                <Alert.Description {...stylex.props(styles.diagnostic)}>
                  {error || snapshot.error}
                </Alert.Description>
              )}
              <Alert.Actions>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const admission = snapshot.admission;
                      if (!(await client.recoverDelivery()))
                        throw new Error('尚未确认送达，请稍后重新读取。');
                      if (admission) {
                        await client.list();
                        await client.open(admission.sessionId);
                        const recovered = client
                          .getSnapshot()
                          .conversations.find((row) => row.id === admission.sessionId);
                        const destination = `lody:chat-draft:${client.accountKey}:${admission.sessionId}`;
                        const sent = recovered?.messages.find(
                          (message) => message.id === admission.operationId,
                        );
                        if (sent) watchSubmittedTurn(admission.sessionId, sent.id);
                        if (
                          sent &&
                          sent.text ===
                            (draft.text.trim()
                              ? draft.text
                              : '请查看这些附件，帮我分析其中的内容。') +
                              (memory ? `\n\n本次采用的个人偏好：\n${memory}` : '') &&
                          sameAttachments(
                            messageAttachments(sent),
                            binary.items.map((item) =>
                              item.ready?.type === 'text' ? undefined : item.ready,
                            ),
                          ) &&
                          sent.contexts.length === draft.contexts.length &&
                          sent.contexts.every((context, index) => {
                            const other = draft.contexts[index];
                            return (
                              other &&
                              context.id === other.id &&
                              context.kind === other.kind &&
                              context.title === other.title &&
                              context.url === other.url &&
                              context.text === other.text &&
                              context.trust === other.trust
                            );
                          })
                        ) {
                          if (binary.items.length)
                            await binary.clear(binary.items.map((item) => item.id));
                          localStorage.removeItem(draftKey);
                          setDraft({ text: '', contexts: [] });
                        } else if (
                          !sent &&
                          draftKey !== destination &&
                          !localStorage.getItem(destination)
                        ) {
                          localStorage.setItem(destination, JSON.stringify(draft));
                          localStorage.removeItem(draftKey);
                        }
                        // Keep unsent binary drafts at their original key until delivery is confirmed.
                        if (sent || !binary.items.length) selectConversation(admission.sessionId);
                      }
                    })
                  }
                >
                  {snapshot.admission.phase === 'awaiting-first-turn'
                    ? '继续这段对话'
                    : '确认发送结果'}
                </Button>
              </Alert.Actions>
            </Alert.Root>
          )}
          {snapshot.gatewayOrigin && snapshot.status === 'error' && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await grantGatewayAccess(snapshot.gatewayOrigin!);
                  location.reload();
                })
              }
            >
              允许连接 Lody
            </Button>
          )}
          {session?.messages
            .filter((message) => message.role === 'system')
            .map((message) => (
              <Alert.Root key={message.id}>
                <Alert.Title>系统消息</Alert.Title>
                <Alert.Description>{message.text}</Alert.Description>
              </Alert.Root>
            ))}
          {permissions}
          {!!session?.queued?.length && (
            <Popover.Root>
              <Popover.Trigger render={<Button variant="ghost" size="small" />}>
                {session.queued.length} 条消息等待当前任务完成
              </Popover.Trigger>
              <Popover.Content>
                <Popover.Header>
                  <Popover.Title>待发送队列</Popover.Title>
                  <Popover.Description>
                    来自工作区同步状态，当前任务完成后由机器处理。
                  </Popover.Description>
                </Popover.Header>
                {session.queued.map((item, index) => (
                  <p
                    key={item.operationId ?? item.userTurnId ?? index}
                    {...stylex.props(styles.diagnostic)}
                  >
                    {item.task}
                  </p>
                ))}
              </Popover.Content>
            </Popover.Root>
          )}
        </>
      }
      contextControls={
        <ComposerContextBar
          currentPage={draft.currentPage ?? false}
          onCurrentPageChange={(currentPage) =>
            setDraft((current) => ({ ...current, currentPage }))
          }
          onSelectTabs={() => setTabs(true)}
          disabled={disabled}
          full={draft.contexts.length >= 8}
        />
      }
      composer={{
        value: draft.text,
        disabled: busy || snapshot.busy || loaded !== draftKey,
        onChange: updateDraftText,
        mentionSource: active ? mentionSource : undefined,
        mentionRanges: draft.mentions ?? [],
        onMentionCommit: updateDraftText,
        onFiles: addFiles,
        onKeyDown: (event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            if (!disabled && !running && !waitingForReply) send();
          }
        },
        attachments: (
          <>
            {memory && (
              <Popover.Root>
                <Popover.Trigger render={<Button variant="ghost" size="small" />}>
                  个人偏好已启用
                </Popover.Trigger>
                <Popover.Content>
                  <Popover.Header>
                    <Popover.Title>本次会附加到消息</Popover.Title>
                  </Popover.Header>
                  <p {...stylex.props(styles.diagnostic)}>{memory}</p>
                </Popover.Content>
              </Popover.Root>
            )}
            <ContextStrip
              contexts={draft.contexts}
              onRefresh={
                busy
                  ? undefined
                  : (previousId, context) => {
                      if (currentDraftKeyRef.current !== draftKey) return;
                      setDraft((current) => ({
                        ...current,
                        contexts: current.contexts.map((item) =>
                          item.id === previousId ? context : item,
                        ),
                      }));
                    }
              }
              remove={
                busy
                  ? undefined
                  : (id) =>
                      setDraft((current) => ({
                        ...current,
                        contexts: current.contexts.filter((context) => context.id !== id),
                      }))
              }
            />
            <DraftAttachments
              items={binary.items}
              disabled={busy}
              progress={binary.progress}
              onRemove={(id) => void act(() => binary.remove(id))}
            />
            {binary.progress && (
              <Button variant="ghost" size="small" onClick={binary.cancel}>
                取消上传
              </Button>
            )}
          </>
        ),
        attachmentAction: (
          <>
            <span hidden>
              <Input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                aria-label="选择附件"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length) addFiles(files);
                }}
              />
            </span>
            <PageContextMenu
              key={draftKey}
              scope={client.accountKey}
              onError={setError}
              disabled={disabled}
              maxRemaining={8 - draft.contexts.length}
              onAdd={(context) => {
                if (currentDraftKeyRef.current !== draftKey) return;
                setDraft((current) => ({
                  ...current,
                  contexts: [
                    ...current.contexts.filter((item) => item.id !== context.id),
                    context,
                  ].slice(0, 8),
                }));
              }}
              onImage={(file) => binary.add([file])}
              onDocument={(file) => binary.add([file])}
              onFiles={() => fileInputRef.current?.click()}
            />
            <Menu.Root>
              <Menu.Trigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    icon
                    disabled={disabled || !snapshot.target}
                    aria-label="选择工具"
                  />
                }
              >
                <Icon name="tools" size={16} />
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item onClick={() => setConnectors(true)}>工作区连接器…</Menu.Item>
                <Menu.Item onClick={() => setSkills(true)}>选择技能…</Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </>
        ),
        configuration: (
          <>
            <RunConfigMenu
              disabled={disabled}
              agentLocked={Boolean(session)}
              agents={snapshot.agents.map((agent) => ({
                ...agent,
                value: agent.id,
                label: agent.name,
              }))}
              agent={snapshot.agents.find((agent) => agent.id === snapshot.target?.agentConfigId)}
              agentId={snapshot.target?.agentConfigId ?? ''}
              onAgentChange={chooseAgent}
              onChooseTarget={() => setTargetOpen(true)}
              configOptions={configOptions}
              configOptionValues={runConfig.configOptionValues}
              onConfigOptionChange={changeOption}
              agentLabel={
                snapshot.agents.find((row) => row.id === snapshot.target?.agentConfigId)?.name ??
                '选择助手'
              }
              models={snapshot.runModels}
              modelId={modelId}
              onModelChange={(id) => setConfig({ ...runConfig, modelId: id, reasoningEffort: '' })}
              reasoningOptions={(model?.reasoningEfforts ?? []).map((value) => ({
                value,
                label: value,
              }))}
              reasoningEffort={runConfig.reasoningEffort}
              onReasoningChange={(reasoningEffort) => setConfig({ ...runConfig, reasoningEffort })}
              onPlanChange={() => {}}
              onFastChange={() => {}}
            />
            <PermissionModeMenu
              disabled={disabled}
              options={snapshot.permissionModes}
              value={modeId}
              onChange={(id) => setConfig({ ...runConfig, modeId: id })}
            />
          </>
        ),
        primaryAction: (
          <>
            {dictationAvailable() && (
              <Tooltip.Root>
                <Tooltip.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      icon
                      disabled={disabled}
                      aria-label="语音输入"
                      onClick={() => setDictation(true)}
                    />
                  }
                >
                  <Icon name="microphone" size={16} />
                </Tooltip.Trigger>
                <Tooltip.Content>语音输入</Tooltip.Content>
              </Tooltip.Root>
            )}
            {running && (draft.text.trim() || binary.items.length > 0) && (
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={disabled || blockedDelivery}
                      aria-label="运行中发送方式"
                    />
                  }
                >
                  发送…
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Item onClick={() => send('queue')}>完成当前回复后发送</Menu.Item>
                  {snapshot.canSteer && (
                    <Menu.Item onClick={() => send('steer')}>补充到当前任务</Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            )}
            <Button
              type={running ? 'button' : 'submit'}
              size="small"
              shape="pill"
              icon
              disabled={
                disabled ||
                (!running &&
                  ((!draft.text.trim() && !binary.items.length) ||
                    blockedDelivery ||
                    waitingForReply))
              }
              aria-label={running ? '停止生成' : '发送消息'}
              onClick={running ? () => void act(() => client.stop(selected)) : undefined}
            >
              {busy || (waitingForReply && !error && !snapshot.error) ? (
                <Spinner size="small" label={null} />
              ) : (
                <Icon name={running ? 'stop' : 'send'} size={16} />
              )}
            </Button>
          </>
        ),
      }}
      footer={
        <div {...stylex.props(styles.meta)}>
          <TargetPicker
            snapshot={snapshot}
            onDiagnostics={() => setDiagnostics(true)}
            open={targetOpen}
            onOpenChange={setTargetOpen}
            busy={busy}
            locked={Boolean(session)}
            onMachine={(machineId) =>
              void act(async () => {
                await client.selectTarget({
                  workspaceId,
                  machineId,
                  agentConfigId: '',
                  project: { kind: 'chat' },
                });
                setConfig(undefined);
              })
            }
            onAgent={chooseAgent}
          />
        </div>
      }
    />
  );
}
