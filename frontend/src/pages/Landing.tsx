import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes, FolderGit2, UploadCloud, Code2, Share2, ShieldCheck, Zap, ChevronDown,
  FileText, Folder, Search, Star, Trash2, HardDrive,
} from 'lucide-react';
import { Btn } from '../components/ui';
import { APP_NAME } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const features = [
  {
    icon: FolderGit2,
    title: 'Repository Terstruktur',
    desc: 'Kelompokkan file dan folder ke dalam repository dengan ikon dan warna kustom, seperti workspace pribadi Anda.',
  },
  {
    icon: UploadCloud,
    title: 'Upload Andal',
    desc: 'Drag & drop file atau seluruh folder. Upload chunked mendukung jeda, lanjut, dan batal kapan saja.',
  },
  {
    icon: Code2,
    title: 'Editor Kode Bawaan',
    desc: 'Edit file langsung di browser dengan syntax highlighting, pencarian & ganti, serta live preview Markdown dan HTML.',
  },
  {
    icon: Share2,
    title: 'Berbagi Fleksibel',
    desc: 'Bagikan file, folder, atau repository lewat tautan publik dengan proteksi password dan masa berlaku.',
  },
  {
    icon: ShieldCheck,
    title: 'Aman Sejak Desain',
    desc: 'Autentikasi JWT dengan cookie HttpOnly, kontrol akses per user, dan kuota storage yang dikelola admin.',
  },
  {
    icon: Zap,
    title: 'Cepat di Edge',
    desc: 'Berjalan di jaringan edge Cloudflare sehingga respons tetap kencang dari mana pun Anda mengakses.',
  },
];

const faqs = [
  {
    q: `Apa itu ${APP_NAME}?`,
    a: `${APP_NAME} adalah platform repository file manager berbasis web. Anda dapat menyimpan, mengelola, mengedit, mengunggah, mengunduh, dan membagikan file maupun folder langsung dari browser tanpa aplikasi tambahan.`,
  },
  {
    q: 'Bagaimana cara mendapatkan akun?',
    a: 'Pendaftaran tidak dibuka untuk publik. Akun dibuat oleh Super Admin. Hubungi administrator untuk mendapatkan kredensial login Anda.',
  },
  {
    q: 'Apakah file saya aman?',
    a: 'Ya. Semua komunikasi terenkripsi HTTPS, sesi login menggunakan cookie HttpOnly yang tidak dapat diakses skrip, dan setiap user hanya dapat mengakses repository miliknya sendiri.',
  },
  {
    q: 'Format file apa saja yang dapat diedit?',
    a: 'Editor bawaan mendukung berbagai bahasa: JavaScript, TypeScript, HTML, CSS, JSON, Markdown, Python, YAML, XML, dan banyak lagi — lengkap dengan syntax highlighting dan live preview untuk Markdown/HTML.',
  },
  {
    q: 'Bisakah saya mengunggah folder sekaligus?',
    a: 'Bisa. Seret folder dari komputer Anda ke area file manager, struktur folder akan dipertahankan secara otomatis. Upload besar berjalan per-chunk dan bisa dijeda atau dilanjutkan.',
  },
  {
    q: 'Apa yang terjadi jika saya menghapus file?',
    a: 'File yang dihapus masuk ke Trash dan dapat dipulihkan. Item di Trash akan dihapus permanen secara otomatis setelah 30 hari.',
  },
];

function Faq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div className="faq-list">
      {faqs.map((f, i) => (
        <div key={i} className="accordion-item">
          <div className="accordion-header" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
            {f.q}
            <ChevronDown size={18} style={{ transform: openIdx === i ? 'rotate(180deg)' : 'none', transition: 'transform 250ms', flexShrink: 0 }} />
          </div>
          {openIdx === i && <div className="accordion-body">{f.a}</div>}
        </div>
      ))}
    </div>
  );
}

function MockPreview() {
  return (
    <div className="preview-frame anim-fade-up">
      <div className="preview-titlebar">
        <span className="preview-dot" style={{ background: '#f26d7d' }} />
        <span className="preview-dot" style={{ background: '#f0b35c' }} />
        <span className="preview-dot" style={{ background: '#5ecf9a' }} />
        <span className="text-dim text-xs" style={{ marginLeft: 10 }}>files.onlyx.top/app</span>
      </div>
      <div style={{ display: 'flex', minHeight: 320 }}>
        <div style={{ width: 170, borderRight: '1px solid var(--glass-border)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }} className="text-sm">
          {[
            { icon: FolderGit2, label: 'Repositories', active: true },
            { icon: Star, label: 'Favorit' },
            { icon: Share2, label: 'Dibagikan' },
            { icon: Trash2, label: 'Trash' },
            { icon: HardDrive, label: 'Storage' },
          ].map((it, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10,
                background: it.active ? 'rgba(var(--accent-rgb), 0.18)' : 'transparent',
                color: it.active ? 'var(--text-0)' : 'var(--text-2)', fontSize: 12.5,
              }}
            >
              <it.icon size={14} />
              {it.label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--glass-border)', color: 'var(--text-2)', fontSize: 12.5, maxWidth: 320 }}>
            <Search size={13} /> Cari file...
          </div>
          {[
            { icon: Folder, name: 'proyek-website', meta: '12 item', color: 'var(--accent)' },
            { icon: Folder, name: 'assets-desain', meta: '34 item', color: 'var(--accent)' },
            { icon: FileText, name: 'README.md', meta: '4.2 KB', color: '#8ab4f8' },
            { icon: Code2, name: 'index.html', meta: '12.8 KB', color: '#f072b6' },
            { icon: Code2, name: 'app.ts', meta: '8.1 KB', color: '#5ecf9a' },
          ].map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10, fontSize: 13, color: 'var(--text-1)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <f.icon size={15} color={f.color} />
              <span style={{ flex: 1 }}>{f.name}</span>
              <span className="text-dim text-xs">{f.meta}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="landing">
      <div className="aurora-bg" />
      <nav className="landing-nav">
        <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 17 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', boxShadow: '0 4px 16px rgba(var(--accent-rgb), 0.45)' }}>
            <Boxes size={19} color="#fff" />
          </div>
          {APP_NAME}
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => document.getElementById('fitur')?.scrollIntoView({ behavior: 'smooth' })}>Fitur</Btn>
          <Btn variant="ghost" onClick={() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' })}>FAQ</Btn>
          <Btn variant="primary" onClick={() => navigate(user ? '/app' : '/login')}>
            {user ? 'Buka Dashboard' : 'Masuk'}
          </Btn>
        </div>
      </nav>

      <section className="hero">
        <span className="badge anim-fade-up">Repository File Manager Modern</span>
        <h1 className="anim-fade-up" style={{ animationDelay: '60ms' }}>
          Simpan, kelola, dan bagikan file Anda — semua dari browser
        </h1>
        <p className="anim-fade-up" style={{ animationDelay: '120ms' }}>
          {APP_NAME} menghadirkan pengalaman file manager kelas desktop di web: repository terorganisir,
          editor kode bawaan, upload drag & drop, dan berbagi tautan yang aman.
        </p>
        <div className="hero-cta anim-fade-up" style={{ animationDelay: '180ms' }}>
          <Btn variant="primary" size="lg" onClick={() => navigate(user ? '/app' : '/login')}>
            {user ? 'Buka Dashboard' : 'Mulai Sekarang'}
          </Btn>
          <Btn size="lg" onClick={() => document.getElementById('fitur')?.scrollIntoView({ behavior: 'smooth' })}>
            Pelajari Fitur
          </Btn>
        </div>
      </section>

      <section className="landing-section" style={{ paddingTop: 0 }}>
        <MockPreview />
      </section>

      <section className="landing-section" id="fitur">
        <h2>Semua yang Anda butuhkan untuk mengelola file</h2>
        <p className="section-sub">
          Dirancang untuk developer, kreator, dan tim kecil yang menginginkan kontrol penuh atas file mereka.
        </p>
        <div className="features-grid">
          {features.map((f, i) => (
            <div key={i} className="card hoverable feature-card anim-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="feat-icon"><f.icon size={22} /></div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="faq">
        <h2>Pertanyaan yang sering diajukan</h2>
        <p className="section-sub">Jawaban singkat untuk hal-hal yang paling sering ditanyakan.</p>
        <Faq />
      </section>

      <section className="big-cta">
        <h2>Siap mengelola file dengan cara yang lebih baik?</h2>
        <p className="text-muted" style={{ maxWidth: 480, textAlign: 'center' }}>
          Masuk dengan akun Anda dan rasakan pengalaman file manager modern di {APP_NAME}.
        </p>
        <Btn variant="primary" size="lg" onClick={() => navigate(user ? '/app' : '/login')}>
          {user ? 'Buka Dashboard' : 'Masuk ke Akun'}
        </Btn>
      </section>

      <footer className="landing-footer">
        <div className="flex items-center gap-2">
          <Boxes size={17} color="var(--accent)" />
          <span className="font-semibold" style={{ color: 'var(--text-0)' }}>{APP_NAME}</span>
        </div>
        <span>© {new Date().getFullYear()} {APP_NAME}. Repository File Manager.</span>
      </footer>
    </div>
  );
}
