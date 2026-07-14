export type RingCentralTokenCache = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  owner_id?: string;
  endpoint_id?: string;
  issued_at: number;
  access_token_expires_at: number;
  refresh_token_expires_at?: number | null;
  raw?: unknown;
};

export interface TokenStore {
  get(): Promise<RingCentralTokenCache | null>;
  set(token: RingCentralTokenCache): Promise<void>;
  del(): Promise<void>;
}
