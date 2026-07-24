import { useState, type FormEvent } from 'react';
import { User as UserIcon, KeyRound, Palette, Save } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Btn } from '../components/ui';

const accentColors = ['#7c6cf0', '#4cc9f0', '#f072b6', '#5ecf9a', '#f0b35c', '#f26d7d', '#c792ea', '#8ab4f8'];

export default function Settings() {
  const { user, settings, refreshUser, applySettings } = useAuth();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api('/api/auth/profile', { method: 'PATCH', body: { display_name: displayName.trim() } });
      await refreshUser();
      toast('Profil berhasil diperbarui', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan profil', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      toast('Konfirmasi password tidak cocok', 'error');
      return;
    }
    if (newPw.length < 8) {
      toast('Password baru minimal 8 karakter', 'error');
      return;
    }
    setSavingPw(true);
    try {
      await api('/api/auth/password', { method: 'POST', body: { old_password: oldPw, new_password: newPw } });
      setOldPw('');
      setNewPw('');
      setConfirmPw('');
      toast('Password berhasil diganti', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengganti password', 'error');
    } finally {
      setSavingPw(false);
    }
  };

  const saveTheme = async (patch: { theme?: 'dark' | 'night'; accent_color?: string }) => {
    applySettings(patch);
    try {
      await api('/api/auth/settings', { method: 'PUT', body: { ...settings, ...patch } });
    } catch {
      toast('Gagal menyinkronkan pengaturan', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 720 }}>
      <div>
        <h1 className="page-title">Pengaturan</h1>
        <p className="page-sub">Kelola profil, keamanan, dan tampilan aplikasi.</p>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center gap-2 mb-3">
          <UserIcon size={18} color="var(--accent)" />
          <h3 style={{ fontSize: 16 }}>Profil</h3>
        </div>
        <form onSubmit={saveProfile} className="flex flex-col gap-3">
          <div className="field">
            <label>Username</label>
            <input className="input" value={user?.username || ''} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="field">
            <label>Nama tampilan</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nama Anda" maxLength={60} />
          </div>
          <Btn type="submit" variant="primary" loading={savingProfile} style={{ alignSelf: 'flex-end' }}>
            <Save size={15} /> Simpan Profil
          </Btn>
        </form>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={18} color="var(--accent)" />
          <h3 style={{ fontSize: 16 }}>Ganti Password</h3>
        </div>
        <form onSubmit={savePassword} className="flex flex-col gap-3">
          <div className="field">
            <label>Password saat ini</label>
            <input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Password baru</label>
              <input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" required minLength={8} />
            </div>
            <div className="field">
              <label>Konfirmasi password baru</label>
              <input className="input" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" required minLength={8} />
            </div>
          </div>
          <Btn type="submit" variant="primary" loading={savingPw} style={{ alignSelf: 'flex-end' }}>
            <Save size={15} /> Ganti Password
          </Btn>
        </form>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center gap-2 mb-3">
          <Palette size={18} color="var(--accent)" />
          <h3 style={{ fontSize: 16 }}>Tampilan</h3>
        </div>
        <div className="field mb-3">
          <label>Tema</label>
          <div className="flex gap-2">
            <button className={`chip${settings.theme === 'dark' ? ' active' : ''}`} onClick={() => saveTheme({ theme: 'dark' })}>
              Dark Premium
            </button>
            <button className={`chip${settings.theme === 'night' ? ' active' : ''}`} onClick={() => saveTheme({ theme: 'night' })}>
              Night (lebih gelap)
            </button>
          </div>
        </div>
        <div className="field">
          <label>Warna aksen</label>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {accentColors.map((c) => (
              <div
                key={c}
                className={`accent-swatch${settings.accent_color === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => saveTheme({ accent_color: c })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
