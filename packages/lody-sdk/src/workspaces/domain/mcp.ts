/** A workspace catalog entry. Connection credentials remain inside the synced document. */
export interface WorkspaceMcpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  description?: string;
  enabledByDefault: boolean;
  hasConnection: boolean;
}
