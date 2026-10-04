export interface StreamsGrant {
  token: string;
  /** Server-provided seconds. No refresh token or gateway fallback is inferred. */
  expiresIn: number;
  gatewayBaseUrl?: string;
  shardHostSuffix?: string;
  [field: string]: unknown;
}
