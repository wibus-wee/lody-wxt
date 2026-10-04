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
  page: { display: 'flex', flexDirection: 'column', gap: 16, padding: 24 },
  columns: { display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(0, 3fr)', gap: 24 },
  list: { display: 'flex', flexDirection: 'column', gap: 8, padding: 0, listStyleType: 'none' },
  turn: {
    padding: 16,
    overflowWrap: 'anywhere',
  },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  prompt: { width: '100%', minHeight: 100 },
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
                <pre>{JSON.stringify(item, null, 2)}</pre>
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
  const [controller] = useState(() => new ConversationRuntimeController(new TurnJournal(scope)));
  const [connection, setConnection] = useState<Awaited<
    ReturnType<typeof connectConversationWorkspace>
  > | null>(null);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [newConversation, setNewConversation] = useState(false);
  const [prompt, setPrompt] = useState(() => localStorage.getItem(`lody:reply:${scope}`) ?? '');
  const [title, setTitle] = useState('');
  const reducedMotion = useReducedMotion();
  const accountId = account.account?.user.id;
  const sessionId = account.account?.session.id;
  const workspaceId = account.workspace?.id;
  const token = account.token?.access_token;
  const signedIn = account.status === 'signed_in';
  const client = account.client;
  useEffect(() => {
    if (!signedIn || !accountId || !sessionId || !workspaceId || !token || !client) return;
    const storageAdapter = new IndexedDBStorageAdaptor({
      dbName: `lody:repo:${scope}`,
      durability: 'strict',
    });
    const opening = connectConversationWorkspace({
      accountId,
      workspaceId,
      token,
      authOrigin: productConfig.authOrigin,
      convexUrl: productConfig.convexOrigin,
      client,
      storageAdapter,
    });
    let active = true;
    void controller.connect(async () => {
      const next = await opening;
      if (active) setConnection(next);
      return next;
    });
    return () => {
      active = false;
      void controller.disconnect();
    };
  }, [controller, signedIn, accountId, sessionId, workspaceId, token, client, scope]);
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
      ...(latestInput.configOptionValues
        ? { configOptionValues: latestInput.configOptionValues }
        : {}),
      cliType: latestInput.cliType,
      agentType: latestInput.agentType,
      prompt,
    };
    void controller
      .send(
        {
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userId: accountId,
          inputConfig,
        },
        kind,
        activeTurn?.id,
      )
      .then(() => {
        if (!controller.getSnapshot().error) {
          localStorage.removeItem(`lody:reply:${scope}`);
          setPrompt('');
        }
      });
  };
  return (
    <section {...stylex.props(styles.page)} aria-label="Workspace conversations">
      <h1>Conversations</h1>
      <output>{state.status === 'connected' ? account.workspace?.name : state.status}</output>
      {state.error && (
        <Alert.Root role="alert">
          <Alert.Description>{state.error}</Alert.Description>
        </Alert.Root>
      )}
      <Button type="button" onClick={() => setNewConversation(true)}>
        New conversation
      </Button>
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
              void controller.refresh().then(() => controller.open(id));
            }}
          />
        )}
      <div {...stylex.props(styles.columns)}>
        <nav aria-label="Conversation list">
          <label htmlFor="conversation-search">
            Search
            <Input
              id="conversation-search"
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
            Archived conversations
          </label>
          <ul {...stylex.props(styles.list)}>
            {rows.slice(page * 20, (page + 1) * 20).map((session) => (
              <li key={session.id}>
                <Button
                  type="button"
                  onClick={() => {
                    void controller.open(session.id);
                    setTitle(session.title ?? '');
                  }}
                >
                  {session.title ?? session.id}
                </Button>
              </li>
            ))}
          </ul>
          <div {...stylex.props(styles.actions)}>
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button disabled={(page + 1) * 20 >= rows.length} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </nav>
        <article aria-label="Conversation history">
          {selected && (
            <>
              <h2>{selected.title ?? selected.id}</h2>
              <Button disabled={state.busy} onClick={() => void controller.open(selected.id)}>
                Check delivery and refresh history
              </Button>
              <div {...stylex.props(styles.actions)}>
                <label htmlFor="conversation-title">
                  Title
                  <Input
                    id="conversation-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
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
                  {selected.isPinned === true ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  disabled={state.busy}
                  onClick={() =>
                    void controller.patch(selected.id, { isArchived: !selected.isArchived })
                  }
                >
                  {selected.isArchived ? 'Restore' : 'Archive'}
                </Button>
                <Collapsible.Root>
                  <Collapsible.Trigger render={<Button variant="destructive" />}>
                    Delete conversation
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
              </div>
              <ol {...stylex.props(styles.list)}>
                {state.snapshot?.history.map((turn) => (
                  <HistoryTurn
                    key={turn.id}
                    turn={turn}
                    controller={controller}
                    busy={state.busy}
                    userId={accountId ?? ''}
                  />
                ))}
              </ol>
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
              <div {...stylex.props(styles.actions)}>
                <m.div
                  whileTap={{ scale: reducedMotion ? 1 : 0.97 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <Button
                    variant="primary"
                    disabled={state.busy || !latestInput || !prompt.trim()}
                    onClick={() => send('dispatch')}
                  >
                    Send
                  </Button>
                </m.div>
                <Button
                  disabled={state.busy || !latestInput || !prompt.trim()}
                  onClick={() => send('queue')}
                >
                  Queue
                </Button>
                <Button
                  disabled={state.busy || !latestInput || !prompt.trim() || !activeTurn}
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
            </>
          )}
          {!selected && <p>Select a conversation to view its history.</p>}
        </article>
      </div>
    </section>
  );
}
