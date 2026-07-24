import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Boxes, Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Btn } from '../components/ui';
import { APP_NAME } from '../services/api';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password, remember);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="aurora-bg" />
      <div className="card auth-card anim-scale-in">
        <Link to="/" className="flex items-center gap-2" style={{ color: 'var(--text-0)', fontWeight: 700, fontSize: 18, justifyContent: 'center' }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', boxShadow: '0 4px 18px rgba(var(--accent-rgb), 0.45)' }}>
            <Boxes size={22} color="#fff" />
          </div>
          {APP_NAME}
        </Link>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 21, letterSpacing: '-0.4px' }}>Selamat datang kembali</h2>
          <p className="text-muted text-sm mt-1">Masuk untuk mengelola file dan repository Anda</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="field">
            <label>Username</label>
            <input
              className="input"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={{ paddingRight: 46 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: 4 }}
              >
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
            Ingat saya selama 30 hari
          </label>

          {error && (
            <div className="badge danger" style={{ padding: '10px 14px', borderRadius: 12, fontSize: 13, justifyContent: 'center' }}>
              {error}
            </div>
          )}

          <Btn variant="primary" size="lg" type="submit" loading={loading} style={{ width: '100%' }}>
            {!loading && <LogIn size={17} />}
            Masuk
          </Btn>
        </form>

        <p className="text-dim text-xs" style={{ textAlign: 'center', lineHeight: 1.6 }}>
          Belum punya akun? Akun hanya dapat dibuat oleh Super Admin.
          <br />Hubungi administrator Anda.
        </p>
      </div>
    </div>
  );
}
