import { GardenDraft } from '@/lib/types';

export function StatusPill({ draft }: { draft?: GardenDraft }) {
  const status = draft?.status || 'empty';
  const label = {
    empty: 'لم يتم الرفع',
    ready: 'جاهزة للإرسال',
    'missing-location': 'صورة بدون موقع',
    sent: 'تم الإرسال',
    duplicate: 'مسجلة مسبقًا',
    failed: 'فشل الإرسال',
  }[status];

  return <span className={`status-pill ${status}`}>{label}</span>;
}
