export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  JOBS: DurableObjectNamespace;
  APP_NAME: string;
  FRONTEND_ORIGIN: string;
  COOKIE_DOMAIN: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  JWT_SECRET: string;
  DEFAULT_QUOTA_BYTES: string;
  TRASH_RETENTION_DAYS: string;
  MAX_EDITOR_FILE_BYTES: string;
  MAX_FILE_BYTES: string;
  ZIP_SYNC_THRESHOLD_BYTES: string;
  STORAGE_PROVIDER: string;
}

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  role: 'super_admin' | 'user';
  status: 'active' | 'disabled';
  quota_bytes: number;
  storage_used_bytes: number;
  avatar_key: string | null;
  created_at: number;
  last_login_at: number | null;
}

export type Variables = {
  user: AuthUser;
};

export interface JwtPayload {
  user_id: string;
  role: string;
  iat: number;
  exp: number;
}

export interface NodeRow {
  id: string;
  repo_id: string;
  parent_id: string | null;
  type: 'file' | 'folder';
  name: string;
  path: string;
  size_bytes: number;
  mime_type: string | null;
  storage_key: string | null;
  is_favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
