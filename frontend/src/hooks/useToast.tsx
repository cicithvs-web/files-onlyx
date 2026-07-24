import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  leaving?: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 300);
  }, []);

  const toast = useCallback(
    (message: string, type: Toast['type'] = 'info') => {
      const id = nextId++;
      setToasts((ts) => [...ts.slice(-4), { id, type, message }]);
      setTimeout(() => remove(id), 4200);
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}${t.leaving ? ' leaving' : ''}`}>
            {t.type === 'success' && <CheckCircle2 size={18} color="var(--success)" style={{ flexShrink: 0, marginTop: 1 }} />}
            {t.type === 'error' && <AlertCircle size={18} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />}
            {t.type === 'info' && <Info size={18} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />}
            <span style={{ flex: 1 }}>{t.message}</span>
            <button className="btn btn-ghost btn-icon" style={{ padding: 2 }} onClick={() => remove(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext);
}
