import { useEffect, useState } from 'react';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import { Btn, EmptyState, SkeletonRows } from '../components/ui';
import { ActivityRow } from './Dashboard';
import type { Activity } from '../types';

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  useEffect(() => {
    setLoading(true);
    api<{ activities: Activity[]; total: number }>(`/api/activities?page=${page}`)
      .then((d) => {
        setActivities(d.activities);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Aktivitas</h1>
        <p className="page-sub">Riwayat lengkap aktivitas akun Anda ({total} entri).</p>
      </div>

      <div className="card" style={{ padding: 20 }}>
        {loading ? (
          <SkeletonRows count={8} height={46} />
        ) : !activities.length ? (
          <EmptyState icon={<Clock size={36} />} title="Belum ada aktivitas" desc="Semua tindakan Anda akan tercatat di sini." />
        ) : (
          <div className="flex flex-col anim-fade-in">
            {activities.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <Btn variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={15} /> Sebelumnya
            </Btn>
            <span className="text-dim text-sm">Halaman {page} dari {totalPages}</span>
            <Btn variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Berikutnya <ChevronRight size={15} />
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
