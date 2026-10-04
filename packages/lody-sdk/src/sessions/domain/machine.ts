export interface MachineInfo {
  id: string;
  name?: string;
  ownerUserId?: string;
  hostType?: 'user' | 'cloud';
  cliVersion?: string;
  os?: string;
  timeZone?: string;
  protocolCapabilities?: Record<string, number>;
}
