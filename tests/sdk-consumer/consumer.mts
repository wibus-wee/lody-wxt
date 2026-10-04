import type {
  Account,
  DataHost,
  DataRead,
  HttpTransport,
  LodyClient,
  RequestOptions,
  StreamsGrant,
  Workspace,
} from '@lody-mobile/sdk';
import { createLodyClient, OfflineDataRuntime } from '@lody-mobile/sdk';
// @ts-expect-error package exports must hide compiled internals
import type { createLodyClient as HiddenDistClient } from '@lody-mobile/sdk/dist/client.js';
// @ts-expect-error package exports must hide direct entrypoint paths
import type { LodyClient as HiddenEntrypoint } from '@lody-mobile/sdk/dist/index.js';
// @ts-expect-error package exports must hide source internals
import type { createLodyClient as HiddenSourceClient } from '@lody-mobile/sdk/src/client.js';

const transport: HttpTransport = async () => ({ status: 200, json: async () => null });
const client: LodyClient = createLodyClient({
  authOrigin: 'https://synthetic.example.test',
  clientId: 'synthetic-client',
  transport,
});
const grant: Promise<StreamsGrant> = client.getStreamsGrant(
  'synthetic-token',
  'synthetic-workspace',
);
const scopedGrant: Promise<StreamsGrant> = client.streams.getGrant(
  'synthetic-token',
  'synthetic-workspace',
);
const account: Promise<Account> = client.getAccount('synthetic-token');
const workspaces: Promise<Workspace[]> = client.workspaces.list('synthetic-token');
const options: RequestOptions = { signal: new AbortController().signal };
const host: DataHost = { start() {}, send(_message: string) {}, dispose() {} };
const runtime = new OfflineDataRuntime(host);
const data: Promise<DataRead> = runtime.data.read({ documentId: 'synthetic' }, options.signal);
void [grant, scopedGrant, account, workspaces, data];
export type HiddenPaths = [typeof HiddenSourceClient, typeof HiddenDistClient, HiddenEntrypoint];
