export interface VisibleMachine {
  machineId: string;
  ownerUserId: string;
  sharedWithTeam: boolean;
  updatedAt: number;
}

export interface VisibleLocalProject extends VisibleMachine {
  localProjectId: string;
}

export class CloudError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'CloudError';
  }
}
