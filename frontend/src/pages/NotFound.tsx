import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Btn } from '../components/ui';

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="aurora-bg" />
      <div className="card auth-card anim-scale-in" style={{ textAlign: 'center' }}>
        <Compass size={44} color="var(--accent)" style={{ margin: '0 auto' }} />
        <h1 style={{ fontSize: 42, letterSpacing: '-1px' }}>404</h1>
        <p className="text-muted">Halaman yang Anda cari tidak ditemukan.</p>
        <Link to="/">
          <Btn variant="primary" style={{ width: '100%' }}>Kembali ke Beranda</Btn>
        </Link>
      </div>
    </div>
  );
}
