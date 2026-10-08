import type { SessionTurn, TurnInput } from '@lody-mobile/sdk';
import * as stylex from '@stylexjs/stylex';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';
import { m, useReducedMotion } from 'motion/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as v from 'valibot';

import { productConfig } from '../../app/product-config';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Collapsible } from '../../shared/ui/collapsible';
import { Input } from '../../shared/ui/input';
import { MessageSurface } from '../../shared/ui/MessageSurface';
import { Switch } from '../../shared/ui/switch';
import { Textarea } from '../../shared/ui/textarea';
import { useAccount } from '../account/useAccount';
import { connectConversationWorkspace } from './connect-runtime';
import { NewSessionSheet } from './NewSessionSheet';
import { ConversationRuntimeController } from './runtime-controller';
import { TurnJournal } from './turn-journal';
import { TurnActions } from './TurnActions';
const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8, padding: 0, listStyleType: 'none' },
  turn: { padding: 12, overflowWrap: 'anywhere' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  prompt: { width: '100%', minHeight: 88 },
  history: { minWidth: 0, overflowWrap: 'anywhere' },
  detail: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  listViewport: { minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' },
  conversationButton: {
    width: '100%',
    justifyContent: 'start',
    textAlign: 'start',
    overflow: 'hidden',
  },
  titleText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  reply: {
    position: 'sticky',
    bottom: 0,
    paddingBlock: 8,
    backgroundColor: 'var(--surface, Canvas)',
  },
});
const textItemSchema = v.object({ type: v.literal('text'), text: v.string() });
const toolItemSchema = v.object({
  type: v.picklist(['tool_call', 'tool']),
  title: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
});

const permissionSchema = v.object({
  type: v.literal('tool_call'),
  permissionRequest: v.object({
    requestId: v.string(),
    options: v.array(v.object({ optionId: v.string(), name: v.optional(v.string()) })),
    outcome: v.optional(v.unknown()),
  }),
});

function HistoryTurn({
  turn,
  controller,
  busy,
  userId,
}: {
  turn: SessionTurn;
  controller: ConversationRuntimeController;
  busy: boolean;
  userId: string;
}) {
  return (
    <li>
      <Card.Root {...stylex.props(styles.turn)}>
        <p>
          {turn.role} · {turn.status ?? (turn.finished ? 'Finished' : 'In progress')}
        </p>
        <MessageSurface
          role={turn.role === 'user' ? 'user' : 'agent'}
          text={
            turn.inputConfig?.prompt ??
            (turn.items ?? [])
              .flatMap((item) => {
                const parsed = v.safeParse(textItemSchema, item);
                return parsed.success ? [parsed.output.text] : [];
              })
              .join('\n\n')
          }
          status={turn.finished ? 'complete' : 'streaming'}
          timestamp={turn.timestamp}
        />
        <TurnActions turn={turn} controller={controller} userId={userId} busy={busy} />
        {turn.items?.map((item, index) => {
          const text = v.safeParse(textItemSchema, item);
          if (text.success) return null;
          const permission = v.safeParse(permissionSchema, item);
          if (permission.success && permission.output.permissionRequest.outcome === undefined) {
            const request = permission.output.permissionRequest;
            return (
              <div key={request.requestId}>
                <p>Permission required</p>
                {request.options.map((option) => (
                  <Button
                    key={option.optionId}
                    disabled={busy}
                    onClick={() =>
                      void controller.respondPermission(turn.id, request.requestId, option.optionId)
                    }
                  >
                    {option.name ?? option.optionId}
                  </Button>
                ))}
                <Button
                  disabled={busy}
                  onClick={() =>
                    void controller.respondPermission(turn.id, request.requestId, null)
                  }
                >
                  Decline
                </Button>
              </div>
            );
          }
          const tool = v.safeParse(toolItemSchema, item);
          return (
            <Collapsible.Root key={`${turn.id}:activity:${index}`}>
              <Collapsible.Trigger render={<Button variant="ghost" />}>
                {tool.success
                  ? `${tool.output.title ?? tool.output.name ?? 'Tool'} · ${tool.output.status ?? 'Activity'}`
                  : 'Activity details'}
              </Collapsible.Trigger>
              <Collapsible.Panel>
                <pre {...stylex.props(styles.detail)}>{JSON.stringify(item, null, 2)}</pre>
              </Collapsible.Panel>
            </Collapsible.Root>
          );
        })}
      </Card.Root>
    </li>
  );
}

export function WorkspacePage() {
  const account = useAccount();
  const scope = JSON.stringify([
    account.config?.authOrigin,
    account.account?.user.id,
    account.workspace?.id,
  ]);
  const fence = JSON.stringify([scope, account.account?.session.id, account.token?.access_token]);
  return <WorkspaceSurface key={fence} scope={scope} />;
}

function WorkspaceSurface({ scope }: { scope: string }) {
  const account = useAccount();
  const [prompt, setPrompt] = useState(() => localStorage.getItem(`lody:reply:${scope}`) ?? '');
  const [controller] = useState(
    () =>
      new ConversationRuntimeController(new TurnJournal(scope), (input) => {
        const key = `lody:reply:${scope}`;
        if (localStorage.getItem(key) === input.inputConfig.prompt) localStorage.removeItem(key);
        setPrompt((current) => (current === input.inputConfig.prompt ? '' : current));
      }),
  );
  const [connection, setConnection] = useState<Awaited<
    ReturnType<typeof connectConversationWorkspace>
  > | null>(null);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [newConversation, setNewConversation] = useState(false);
  const [showList, setShowList] = useState(true);
  const [title, setTitle] = useState('');
  const reducedMotion = useReducedMotion();
  const accountId = account.account?.user.id;
  const sessionId = account.account?.session.id;
  const workspaceId = account.workspace?.id;
  const token = account.token?.access_token;
  const signedIn = account.status === 'signed_in';
  const client = account.client;
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshList = async () => {
    setRefreshing(true);
    try {
      await controller.refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const openConversation = async (id: string) => {
    setTitle(state.sessions.find((session) => session.id === id)?.title ?? '');
    await controller.open(id);
    if (controller.getSnapshot().snapshot?.sessionId === id) setShowList(false);
  };
  useEffect(() => {
    if (!signedIn || !accountId || !sessionId || !workspaceId || !token || !client) return;
    const storageAdapter = new IndexedDBStorageAdaptor({
      dbName: `lody:repo:${scope}`,
      durability: 'strict',
    });
    const lifecycle = new AbortController();
    const selected = controller.getSnapshot().snapshot?.sessionId;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    void controller
      .connect(async () => {
        const next = await connectConversationWorkspace({
          accountId,
          workspaceId,
          token,
          authOrigin: productConfig.authOrigin,
          convexUrl: productConfig.convexOrigin,
          client,
          storageAdapter,
          signal: lifecycle.signal,
          onDisconnect: () => {
            clearTimeout(reconnect);
            reconnect = setTimeout(() => {
              if (!lifecycle.signal.aborted) setConnectionRevision((value) => value + 1);
            }, 500);
          },
        });
        if (active) setConnection(next);
        return next;
      })
      .then(async () => {
        if (active && selected && controller.getSnapshot().status === 'connected')
          await controller.open(selected);
      });
    return () => {
      active = false;
      clearTimeout(reconnect);
      lifecycle.abort();
      void controller.disconnect();
    };
  }, [
    controller,
    signedIn,
    accountId,
    sessionId,
    workspaceId,
    token,
    client,
    scope,
    connectionRevision,
  ]);
  const rows = state.sessions.filter(
    (session) =>
      session.isArchived === archived &&
      (session.title ?? session.id).toLowerCase().includes(search.toLowerCase()),
  );
  const selected = state.sessions.find((session) => session.id === state.snapshot?.sessionId);
  const latestInput = state.snapshot?.history.findLast(
    (turn) => turn.role === 'user' && turn.inputConfig,
  )?.inputConfig;
  const activeTurn = state.snapshot?.history.findLast(
    (turn) => turn.role === 'assistant' && !turn.finished,
  );
  const send = (kind: 'dispatch' | 'queue' | 'guide') => {
    if (!accountId || !latestInput?.cliType || !latestInput.agentType || !prompt.trim()) return;
    const inputConfig: TurnInput = {
      ...(latestInput.modelId ? { modelId: latestInput.modelId } : {}),
      ...(latestInput.modeId ? { modeId: latestInput.modeId } : {}),
      ...(latestInput.mcpServerIds !== undefined
        ? { mcpServerIds: [...latestInput.mcpServerIds] }
        : {}),
      ...(latestInput.configOptionValues
        ? { configOptionValues: latestInput.configOptionValues }
        : {}),
      cliType: latestInput.cliType,
      agentType: latestInput.agentType,
      prompt,
    };
    void controller.send(
      {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: accountId,
        inputConfig,
      },
      kind,
      activeTurn?.id,
    );
  };
  return (
    <section {...stylex.props(styles.page)} aria-label="Workspace conversations">
      <header {...stylex.props(styles.actions)}>
        {selected ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setShowList(true)}>
              All conversations
            </Button>
            <h1 {...stylex.props(styles.titleText)}>{selected.title ?? selected.id}</h1>
          </>
        ) : (
          <h1>Conversations</h1>
        )}
      </header>
      <output aria-live="polite">
        {state.status === 'connected'
          ? `${account.workspace?.name ?? 'Workspace'} · ${state.sessions.length} conversations`
          : state.status === 'connecting'
            ? 'Connecting to workspace…'
            : state.status}
      </output>
      {state.error && (
        <Alert.Root role="alert">
          <Alert.Description>{state.error}</Alert.Description>
        </Alert.Root>
      )}
      {!selected || showList ? (
        <>
          <div {...stylex.props(styles.actions)}>
            <Button
              type="button"
              disabled={state.status === 'connecting' || refreshing || !signedIn}
              onClick={() => {
                if (state.status === 'connected') void refreshList();
                else setConnectionRevision((value) => value + 1);
              }}
            >
              {state.status === 'connected'
                ? refreshing
                  ? 'Refreshing conversations…'
                  : 'Refresh conversations'
                : state.status === 'connecting'
                  ? 'Connecting…'
                  : 'Retry connection'}
            </Button>
            <Button
              type="button"
              disabled={state.status !== 'connected'}
              onClick={() => setNewConversation(true)}
            >
              New conversation
            </Button>
          </div>
          {newConversation &&
            connection &&
            state.status === 'connected' &&
            accountId &&
            workspaceId &&
            token && (
              <NewSessionSheet
                key={scope}
                connection={connection}
                userId={accountId}
                workspaceId={workspaceId}
                token={token}
                scope={scope}
                onClose={() => setNewConversation(false)}
                onCreated={(id) => {
                  setNewConversation(false);
                  setShowList(false);
                  void controller.refresh().then(() => controller.open(id));
                }}
              />
            )}
          <nav aria-label="Conversation list">
            <label htmlFor="conversation-search">
              Search conversations
              <Input
                id="conversation-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label htmlFor="archived-conversations">
              <Switch
                id="archived-conversations"
                checked={archived}
                onCheckedChange={(checked) => {
                  setArchived(checked);
                  setPage(0);
                }}
              />
              Show archived conversations
            </label>
            <div {...stylex.props(styles.listViewport)}>
              {state.status !== 'connected' ? (
                <p role={state.status === 'error' ? 'alert' : 'status'}>
                  {state.status === 'error'
                    ? 'Could not load conversations. Check the connection and try again.'
                    : 'Loading conversations…'}
                </p>
              ) : rows.length === 0 ? (
                <p>
                  {search.trim()
                    ? 'No conversations match this search. Try another title or clear the search.'
                    : archived
                      ? 'No archived conversations yet.'
                      : 'No conversations yet. Create one to get started.'}
                </p>
              ) : (
                <ul {...stylex.props(styles.list)}>
                  {rows.slice(page * 20, (page + 1) * 20).map((session) => (
                    <li key={session.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        {...stylex.props(styles.conversationButton)}
                        onClick={() => void openConversation(session.id)}
                      >
                        {session.isPinned ? 'Pinned · ' : ''}
                        {session.title ?? session.id}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {rows.length > 20 && (
              <div {...stylex.props(styles.actions)}>
                <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span aria-live="polite">
                  {page + 1} / {Math.ceil(rows.length / 20)}
                </span>
                <Button disabled={(page + 1) * 20 >= rows.length} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </nav>
        </>
      ) : null}
      {selected && !showList && (
        <>
          <div {...stylex.props(styles.actions)}>
            <Button disabled={state.busy} onClick={() => void controller.open(selected.id)}>
              Refresh history / check delivery
            </Button>
            <Collapsible.Root>
              <Collapsible.Trigger render={<Button variant="ghost" />}>
                More conversation actions
              </Collapsible.Trigger>
              <Collapsible.Panel>
                <label htmlFor="conversation-title">
                  Conversation title
                  <Input
                    id="conversation-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <div {...stylex.props(styles.actions)}>
                  <Button
                    disabled={state.busy || !title.trim()}
                    onClick={() => void controller.patch(selected.id, { title: title.trim() })}
                  >
                    Rename
                  </Button>
                  <Button
                    disabled={state.busy}
                    onClick={() =>
                      void controller.patch(selected.id, { isPinned: selected.isPinned !== true })
                    }
                  >
                    {selected.isPinned ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button
                    disabled={state.busy}
                    onClick={() =>
                      void controller.patch(selected.id, { isArchived: !selected.isArchived })
                    }
                  >
                    {selected.isArchived ? 'Restore from archive' : 'Archive'}
                  </Button>
                </div>
                <Collapsible.Root>
                  <Collapsible.Trigger render={<Button variant="destructive" />}>
                    Delete conversation…
                  </Collapsible.Trigger>
                  <Collapsible.Panel>
                    <p>This permanently requests deletion on the machine.</p>
                    <Button
                      variant="destructive"
                      disabled={state.busy}
                      onClick={() => void controller.deleteSession(selected.id)}
                    >
                      Confirm deletion
                    </Button>
                  </Collapsible.Panel>
                </Collapsible.Root>
              </Collapsible.Panel>
            </Collapsible.Root>
          </div>
          {state.deliveryPending && (
            <Alert.Root role="alert">
              <Alert.Description>
                Delivery is unconfirmed. Refresh history to check the request before sending again.
              </Alert.Description>
            </Alert.Root>
          )}
          <article aria-label="Conversation history" {...stylex.props(styles.history)}>
            {state.snapshot?.history.length ? (
              <ol {...stylex.props(styles.list)}>
                {state.snapshot.history.map((turn) => (
                  <HistoryTurn
                    key={turn.id}
                    turn={turn}
                    controller={controller}
                    busy={state.busy || state.deliveryPending}
                    userId={accountId ?? ''}
                  />
                ))}
              </ol>
            ) : (
              <output>
                This conversation has no messages yet. Write a message below to begin.
              </output>
            )}
          </article>
          <div {...stylex.props(styles.reply)}>
            <label htmlFor="conversation-message">
              Message
              <Textarea
                id="conversation-message"
                {...stylex.props(styles.prompt)}
                value={prompt}
                onChange={(event) => {
                  localStorage.setItem(`lody:reply:${scope}`, event.target.value);
                  setPrompt(event.target.value);
                }}
              />
            </label>
            {!latestInput && (
              <p>Reply options will be available after conversation settings load.</p>
            )}
            <div {...stylex.props(styles.actions)}>
              <m.div
                whileTap={{ scale: reducedMotion ? 1 : 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <Button
                  variant="primary"
                  disabled={state.busy || state.deliveryPending || !latestInput || !prompt.trim()}
                  onClick={() => send('dispatch')}
                >
                  Send
                </Button>
              </m.div>
              <Button
                disabled={state.busy || state.deliveryPending || !latestInput || !prompt.trim()}
                onClick={() => send('queue')}
              >
                Queue
              </Button>
              <Button
                disabled={
                  state.busy ||
                  state.deliveryPending ||
                  !latestInput ||
                  !prompt.trim() ||
                  !activeTurn
                }
                onClick={() => send('guide')}
              >
                Steer active turn
              </Button>
              <Button
                disabled={state.busy || !activeTurn}
                onClick={() => {
                  if (activeTurn) void controller.stop(activeTurn.id);
                }}
              >
                Stop active turn
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
