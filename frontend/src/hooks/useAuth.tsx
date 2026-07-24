import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { User, Settings } from '../types';

interface AuthContextValue {
  user: User | null;
  settings: Settings;
  loading: boolean;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  applySettings: (s: Partial<Settings>) => void;
}

const defaultSettings: Settings = { theme: 'dark', accent_color: '#7c6cf0', language: 'id' };

const AuthContext = createContext<AuthContextValue>({
  user: null,
  settings: defaultSettings,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
  applySettings: () => {},
});

function hexToRgb(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function applyThemeToDom(s: Settings) {
  document.documentElement.setAttribute('data-theme', s.theme === 'night' ? 'night' : 'dark');
  document.documentElement.style.setProperty('--accent', s.accent_color);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(s.accent_color));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const cached = localStorage.getItem('fo_settings');
      return cached ? { ...defaultSettings, ...(JSON.parse(cached) as Settings) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => applyThemeToDom(settings), [settings]);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api<{ user: User; settings: Settings }>('/api/auth/me');
      setUser(data.user);
      if (data.settings) {
        setSettings((prev) => ({ ...prev, ...data.settings }));
        localStorage.setItem('fo_settings', JSON.stringify(data.settings));
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean) => {
      const data = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: { username, password, remember },
        skipRefresh: true,
      });
      setUser(data.user);
      await refreshUser();
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    setUser(null);
  }, []);

  const applySettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...s };
      localStorage.setItem('fo_settings', JSON.stringify(merged));
      return merged;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, settings, loading, login, logout, refreshUser, applySettings }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
