import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as v from 'valibot';

import { productConfig } from '../../app/product-config';
import { Icon } from '../../shared/icons/Icon';
import { Alert, Button, Menu, Spinner, Tooltip } from '../../shared/ui';
import { ActivityStatus } from '../../shared/ui/ActivityStatus';
import { formatMessageTime } from '../../shared/ui/format-message-time';
import { MessageAttachments } from '../../shared/ui/MessageAttachments';
import { PermissionModeMenu } from '../../shared/ui/PermissionModeMenu';
import { RunConfigMenu } from '../../shared/ui/RunConfigMenu';
import { AccountPage } from '../account/AccountPage';
import { useAccount } from '../account/useAccount';
import type { LodyClient, PageContext, RunConfig } from '../connection/client';
import { configurationValuesForModel } from '../connection/run-configuration';
import { grantGatewayAccess } from '../connection/state';
import { useLodyClient } from '../connection/use-client';
import { capturePage } from '../page-context/capture';
import { ContextStrip } from '../page-context/ContextStrip';
import { Chat } from './Chat';
import { ChatHeader } from './ChatHeader';
import { ChatHistory } from './ChatHistory';
import type { ChatMessage } from './MessageView';
import { contextSchema } from './real-adapter';
import { TargetPicker } from './TargetPicker';

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
  hint: { margin: 0, fontSize: 11, flexShrink: 0 },
  title: {
    margin: 0,
    fontSize: 12,
    fontWeight: 400,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
const draftSchema = v.object({ text: v.string(), contexts: v.array(contextSchema) });
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
    <ClientChat key={client.accountKey} client={client} workspaceId={account.workspace?.id ?? ''} />
  );
}

function ClientChat({ client, workspaceId }: { client: LodyClient; workspaceId: string }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [targetOpen, setTargetOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const actionRef = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<RunConfig>();
  const draftKey = `lody:chat-draft:${client.accountKey}:${selected || 'new'}`;
  const [draft, setDraft] = useState<{ text: string; contexts: PageContext[] }>({
    text: '',
    contexts: [],
  });
  const [loaded, setLoaded] = useState('');
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
  useEffect(() => {
    if (loaded === draftKey)
      document
        .querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]')
        ?.focus({ preventScroll: true });
  }, [loaded, draftKey]);
  const session = snapshot.conversations.find((row) => row.id === selected);
  const running = session?.messages.some(
    (message) => message.role === 'agent' && message.status === 'streaming',
  );
  const latest = session?.messages.at(-1);
  const waitingForReply =
    latest?.role === 'user' && new Set(['pending', 'seen']).has(latest.turn.status ?? '');
  const modelId = config?.modelId ?? snapshot.runModels[0]?.value ?? '';
  const model = snapshot.runModels.find((row) => row.value === modelId);
  const configOptions = snapshot.modelConfigOptions?.[modelId] ?? snapshot.configOptions ?? [];
  const declaredMode = v.safeParse(
    v.string(),
    configOptions.find(
      (option) => option.type === 'select' && new Set(['mode', 'modeId']).has(option.id),
    )?.currentValue,
  );
  const modeId =
    config?.modeId ??
    (snapshot.permissionModes.length
      ? declaredMode.success
        ? declaredMode.output
        : snapshot.permissionModes[0]?.value
      : '') ??
    '';
  const runConfig: RunConfig = {
    modelId,
    modeId,
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
  const act = async (operation: () => Promise<void>) => {
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
      ...(new Set(['model', 'modelId']).has(id) ? { modelId: v.parse(v.string(), value) } : {}),
      ...(snapshot.permissionModes.length && new Set(['mode', 'modeId']).has(id)
        ? { modeId: v.parse(v.string(), value) }
        : {}),
      configOptionValues: { ...runConfig.configOptionValues, [id]: value },
    });
  const open = (id: string) =>
    void act(async () => {
      await client.open(id);
      setSelected(id);
      setConfig(undefined);
    });
  const send = () =>
    void act(async () => {
      if (!draft.text.trim() || running || loaded !== draftKey || snapshot.status !== 'connected')
        return;
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
      if (!modelId) throw new Error('助手尚未提供模型，请刷新助手配置。');
      const submitted = draft;
      const input = {
        operationId: crypto.randomUUID(),
        text: submitted.text,
        contexts: submitted.contexts,
        inputConfig: runConfig,
      };
      let target = session;
      if (target) await client.send({ ...input, sessionId: target.id });
      else {
        if (!snapshot.target) throw new Error('选择机器与 Agent。');
        target = await client.start({ ...snapshot.target, project: { kind: 'chat' } }, input);
        await client.open(target.id);
        setSelected(target.id);
      }
      setDraft((current) =>
        current.text === submitted.text ? { text: '', contexts: [] } : current,
      );
      localStorage.removeItem(draftKey);
      localStorage.removeItem(`lody:chat-draft:${client.accountKey}:${target.id}`);
    });
  const attach = (kind: 'page' | 'selection') =>
    void act(async () => {
      if (draft.contexts.length >= 3) throw new Error('最多附加 3 份网页资料。');
      const context = await capturePage(kind);
      setDraft((current) => ({ ...current, contexts: [...current.contexts, context] }));
    });
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
    .map((message) => ({
      id: message.id,
      role: message.role === 'user' ? 'user' : 'agent',
      text: message.text,
      status: message.status,
      timestamp: formatMessageTime(message.role === 'user' ? message.createdAt : message.endedAt),
      activities: message.activities,
      attachments: <MessageAttachments contexts={message.contexts} />,
      configuration: message.inputConfig ? (
        <span>
          {message.inputConfig.modelId} · {message.inputConfig.modeId}
        </span>
      ) : null,
    }));
  const disabled = busy || snapshot.busy || snapshot.status !== 'connected' || loaded !== draftKey;
  const blockedDelivery = Boolean(
    snapshot.admission &&
    !(
      snapshot.admission.phase === 'awaiting-first-turn' &&
      session?.id === snapshot.admission.sessionId
    ),
  );
  return (
    <Chat
      key={selected}
      messages={messages}
      onSubmit={send}
      conversationControl={
        <ChatHeader>
          <ChatHistory
            conversations={snapshot.conversations}
            selected={selected}
            disabled={busy}
            onOpen={open}
          />
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
                    setSelected('');
                    setConfig(undefined);
                    setError('');
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
          if (kind !== 'question') {
            const context = await capturePage(kind === 'summary' ? 'page' : 'selection');
            setDraft({
              text: kind === 'summary' ? '帮我总结这个网页的重点。' : '帮我解释这段文字。',
              contexts: [context],
            });
          } else setDraft((current) => ({ ...current, text: '帮我梳理一下思路：' }));
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
        ) : snapshot.target && !modelId ? (
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
            获取模型配置
          </ActivityStatus>
        ) : waitingForReply ? (
          <ActivityStatus busy>等待助手回复</ActivityStatus>
        ) : null)
      }
      feedback={
        <>
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
                        if (
                          sent &&
                          sent.text === draft.text &&
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
                        setSelected(admission.sessionId);
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
        </>
      }
      composer={{
        value: draft.text,
        disabled: busy || snapshot.busy || loaded !== draftKey,
        onChange: (text) => setDraft((current) => ({ ...current, text })),
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
          <ContextStrip
            contexts={draft.contexts}
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
        ),
        attachmentAction: (
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button
                  variant="ghost"
                  size="small"
                  icon
                  disabled={disabled}
                  aria-label="附加上下文"
                />
              }
            >
              <Icon name="plus" size={16} />
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item onClick={() => attach('page')}>附加当前页面</Menu.Item>
              <Menu.Item onClick={() => attach('selection')}>附加选中文字</Menu.Item>
            </Menu.Content>
          </Menu.Root>
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
          <Button
            type={running ? 'button' : 'submit'}
            size="small"
            shape="pill"
            icon
            disabled={
              disabled || (!running && (!draft.text.trim() || blockedDelivery || waitingForReply))
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
        ),
      }}
      footer={
        <div {...stylex.props(styles.meta)}>
          <TargetPicker
            snapshot={snapshot}
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
          <span {...stylex.props(styles.hint)}>仅发送你附加的网页</span>
        </div>
      }
    />
  );
}
