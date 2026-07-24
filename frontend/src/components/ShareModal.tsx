import { useState } from 'react';
import { Link2, Copy, Check } from 'lucide-react';
import { api } from '../services/api';
import { useToast } from '../hooks/useToast';
import { Btn, Modal } from './ui';

export function ShareModal({
  open, onClose, targetType, targetId, targetName,
}: {
  open: boolean;
  onClose: () => void;
  targetType: 'repo' | 'node';
  targetId: string;
  targetName: string;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('0');
  const [link, setLink] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const res = await api<{ token: string }>('/api/shares', {
        method: 'POST',
        body: {
          target_type: targetType,
          target_id: targetId,
          password: password || undefined,
          expires_in_hours: parseInt(expiry, 10) || undefined,
        },
      });
      setLink(`${window.location.origin}/s/${res.token}`);
      toast('Tautan share berhasil dibuat', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat tautan', 'error');
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Bagikan "${targetName}"`} desc="Buat tautan publik yang dapat diakses siapa saja.">
      {!link ? (
        <div className="flex flex-col gap-3">
          <div className="field">
            <label>Password (opsional)</label>
            <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Kosongkan jika tanpa password" />
          </div>
          <div className="field">
            <label>Masa berlaku</label>
            <select className="select" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="0">Tanpa batas</option>
              <option value="1">1 jam</option>
              <option value="24">24 jam</option>
              <option value="168">7 hari</option>
              <option value="720">30 hari</option>
            </select>
          </div>
          <div className="flex gap-2 justify-between mt-2">
            <Btn variant="ghost" onClick={onClose}>Batal</Btn>
            <Btn variant="primary" loading={creating} onClick={create}><Link2 size={15} /> Buat Tautan</Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="field">
            <label>Tautan share</label>
            <div className="flex gap-2">
              <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
              <Btn variant="primary" size="icon" onClick={copy} data-tooltip={copied ? 'Tersalin!' : 'Salin'}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Btn>
            </div>
          </div>
          <p className="text-dim text-xs">
            {password ? 'Tautan dilindungi password. ' : ''}
            {expiry !== '0' ? `Berlaku selama ${expiry} jam.` : 'Berlaku tanpa batas waktu.'}
          </p>
          <Btn variant="ghost" onClick={onClose} style={{ alignSelf: 'flex-end' }}>Selesai</Btn>
        </div>
      )}
    </Modal>
  );
}
