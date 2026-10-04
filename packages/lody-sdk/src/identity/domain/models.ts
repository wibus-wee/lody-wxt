export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  [field: string]: unknown;
}

export interface DeviceAuthorization {
  code: DeviceCode;
  /** Anchored before the code request, never extended when polling starts later. */
  expiresAtMs: number;
}

export interface DeviceToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  [field: string]: unknown;
}

export type DeviceTokenResult =
  | { state: 'authorized'; token: DeviceToken }
  | { state: 'authorization_pending' | 'slow_down' };

export interface AccountUser {
  id: string;
  email: string;
  name?: string;
  image?: string | null;
  emailVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [field: string]: unknown;
}

export interface AccountSession {
  id: string;
  userId: string;
  expiresAt: string;
  token?: string;
  createdAt?: string;
  updatedAt?: string;
  activeOrganizationId?: string | null;
  [field: string]: unknown;
}

export interface Account {
  user: AccountUser;
  session: AccountSession;
  [field: string]: unknown;
}
