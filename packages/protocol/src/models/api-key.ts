/**
 * Team API key records.
 *
 * Per project decision the `key` is stored as plaintext in the team-server
 * DB so the admin can re-show a forgotten key to a member through the Web
 * UI. Members never have a way to retrieve their own key — only the admin
 * does. Rotation is revoke + recreate.
 */

export type ApiKeyScope = 'read' | 'write' | 'admin';

export type ApiKeyRole = 'admin' | 'member';

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  scopes: ApiKeyScope[];
  /** Wildcard ('*') means all projects. */
  projects: string[];
  role: ApiKeyRole;
  createdAt: string;
  createdBy?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  projects: string[];
  role?: ApiKeyRole;
  createdBy?: string;
  /** Optional explicit key (used for bootstrap from TEAM_API_KEY). */
  key?: string;
}
