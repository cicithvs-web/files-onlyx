export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  role: 'super_admin' | 'user';
  status: 'active' | 'disabled';
  quota_bytes: number;
  storage_used_bytes: number;
  created_at: number;
  last_login_at: number | null;
}

export interface Settings {
  theme: string;
  accent_color: string;
  language: string;
}

export interface Repo {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  is_public: number;
  is_archived: number;
  is_favorite: number;
  size_bytes: number;
  created_at: number;
  updated_at: number;
  owner_username?: string;
  file_count?: number;
}

export interface FileNode {
  id: string;
  repo_id: string;
  parent_id: string | null;
  type: 'file' | 'folder';
  name: string;
  path: string;
  size_bytes: number;
  mime_type: string | null;
  is_favorite: number;
  created_at: number;
  updated_at: number;
  repo_name?: string;
}

export interface Activity {
  id: string;
  user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  created_at: number;
}

export interface Share {
  id: string;
  token: string;
  target_type: 'repo' | 'node';
  target_id: string;
  target_name?: string;
  visibility: string;
  password_hash: string | null;
  expires_at: number | null;
  created_at: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface DashboardData {
  repo_count: number;
  file_count: number;
  folder_count: number;
  storage_used: number;
  storage_quota: number;
  recent_repos: Repo[];
  recent_activity: Activity[];
}

export interface TrashData {
  repos: Array<{ id: string; name: string; icon: string; color: string; size_bytes: number; deleted_at: number; item_type: 'repo' }>;
  nodes: Array<{
    id: string; name: string; type: string; path: string; size_bytes: number;
    deleted_at: number; repo_id: string; repo_name: string; item_type: 'node';
  }>;
  retention_days: number;
}
