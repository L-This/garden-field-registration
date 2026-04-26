'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudUpload,
  Image as ImageIcon,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
  ShieldCheck,
  Sprout,
  XCircle,
} from 'lucide-react';
import { getProject } from '@/data/projects';
import { getGardensByProject } from '@/data/gardens';
import { submitIrrigationReport } from '@/lib/api';

type DraftStatus = 'empty' | 'ready' | 'missing-location' | 'sent' | 'duplicate' | 'failed';

type GardenDraft = {
  gardenId: string;
  gardenName: string;
  imagePreview?: string;
  location?: {
    lat: number;
    lng: number;
    accuracy?: number;
  };
  status: DraftStatus;
  note?: string;
};

type FieldSubmitResult = {
  ok: boolean;
  message: string;
  details?: unknown[];
};
  status: DraftStatus;
  note?: string;
};

const todayLabel = new Intl.DateTimeFormat('ar-SA', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(new Date());

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = String(params.projectId || '');
  const project = getProject(projectId);
  const gardens = useMemo(() => getGardensByProject(projectId), [projectId]);

  const [drafts, setDrafts] = useState<Record<string, GardenDraft>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'ready' | 'missing' | 'empty'>('all');
  const [managerName, setManagerName] = useState('مدير المشروع');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FieldSubmitResult | null>(null);

  if (!project) {
    return (
      <main className="project-page">
        <section className="project-empty-state">
          <h1>المشروع غير موجود</h1>
          <p>تأكد من رابط المشروع أو ارجع للصفحة الرئيسية.</p>
          <Link href="/" className="primary-link">العودة للرئيسية</Link>
        </section>
      </main>
    );
  }

  const updateDraft = (gardenId: string, patch: Partial<GardenDraft>) => {
    const garden = gardens.find((item) => item.id === gardenId);
    if (!garden) return;

    setDrafts((current) => {
      const previous = current[gardenId] || {
        gardenId,
        gardenName: garden.name,
        status: 'empty' as DraftStatus,
      };

      const next = { ...previous, ...patch };
      if (next.imagePreview && next.location) next.status = 'ready';
      else if (next.imagePreview && !next.location) next.status = 'missing-location';
      else next.status = 'empty';

      return { ...current, [gardenId]: next };
    });
  };

  const handleImage = async (gardenId: string, file?: File) => {
    if (!file) return;
    const imagePreview = await fileToBase64(file);
    updateDraft(gardenId, { imagePreview, note: 'تم تجهيز الصورة' });
  };

  const handleLocation = (gardenId: string) => {
    if (!navigator.geolocation) {
      updateDraft(gardenId, { status: 'failed', note: 'المتصفح لا يدعم تحديد الموقع' });
      return;
    }

    updateDraft(gardenId, { note: 'جاري جلب الموقع...' });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateDraft(gardenId, {
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          note: 'تم حفظ الموقع',
        });
      },
      () => {
        updateDraft(gardenId, { status: 'failed', note: 'تعذر جلب الموقع، تأكد من السماح للمتصفح' });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const clearGarden = (gardenId: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[gardenId];
      return next;
    });
  };

  const readyDrafts = Object.values(drafts).filter((draft) => draft.status === 'ready' || draft.status === 'missing-location');
  const withImage = Object.values(drafts).filter((draft) => Boolean(draft.imagePreview)).length;
  const withLocation = Object.values(drafts).filter((draft) => Boolean(draft.location)).length;
  const readyCount = readyDrafts.length;
  const progress = gardens.length ? Math.round((readyCount / gardens.length) * 100) : 0;

  const filteredGardens = gardens.filter((garden) => {
    const draft = drafts[garden.id];
    const matchesQuery = garden.name.includes(query) || garden.zone?.includes(query);

    if (!matchesQuery) return false;
    if (filter === 'ready') return draft?.status === 'ready';
    if (filter === 'missing') return draft?.status === 'missing-location';
    if (filter === 'empty') return !draft || draft.status === 'empty';
    return true;
  });

  const submitReport = async () => {
    if (!readyDrafts.length) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await submitIrrigationReport({
        projectId,
        managerName,
        submittedAt: new Date().toISOString(),
        records: readyDrafts,
      });
      setResult(response);
    } catch {
      setResult({
        ok: false,
        message: 'تعذر إرسال التقرير. تحقق من الربط الخلفي ثم أعد المحاولة.',
        details: [],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="project-page field-shell" dir="rtl">
      <section className="field-hero">
        <div>
          <Link href="/" className="back-link">
            <ArrowLeft size={18} /> العودة للمشاريع
          </Link>
          <div className="hero-badge"><ShieldCheck size={16} /> نظام تسجيل ميداني</div>
          <h1>{project.name}</h1>
          <p>{project.district}</p>
        </div>
        <div className="hero-date">
          <span>تاريخ التسجيل</span>
          <strong>{todayLabel}</strong>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card"><span>إجمالي الحدائق</span><strong>{gardens.length}</strong></div>
        <div className="stat-card"><span>جاهزة للإرسال</span><strong>{readyCount}</strong></div>
        <div className="stat-card"><span>صور مرفوعة</span><strong>{withImage}</strong></div>
        <div className="stat-card"><span>مواقع محفوظة</span><strong>{withLocation}</strong></div>
      </section>

      <section className="progress-panel">
        <div>
          <h2>نسبة التجهيز اليومي</h2>
          <p>جهّز الصور والمواقع ثم أرسل التقرير دفعة واحدة.</p>
        </div>
        <strong>{progress}%</strong>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="toolbar-card">
        <label className="manager-field">
          <span>اسم المسؤول</span>
          <input value={managerName} onChange={(e) => setManagerName(e.target.value)} />
        </label>

        <div className="search-field">
          <Search size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم الحديقة أو النطاق" />
        </div>

        <div className="filter-pills">
          <button onClick={() => setFilter('all')} className={filter === 'all' ? 'active' : ''}>الكل</button>
          <button onClick={() => setFilter('ready')} className={filter === 'ready' ? 'active' : ''}>جاهزة</button>
          <button onClick={() => setFilter('missing')} className={filter === 'missing' ? 'active' : ''}>ناقصة موقع</button>
          <button onClick={() => setFilter('empty')} className={filter === 'empty' ? 'active' : ''}>لم تجهز</button>
        </div>
      </section>

      <section className="gardens-grid">
        {filteredGardens.map((garden) => {
          const draft = drafts[garden.id];
          const status = draft?.status || 'empty';
          const mapsUrl = draft?.location
            ? `https://www.google.com/maps?q=${draft.location.lat},${draft.location.lng}`
            : '';

          return (
            <article key={garden.id} className={`garden-card-pro ${status}`}>
              <div className="garden-card-head">
                <div className="garden-icon"><Sprout size={22} /></div>
                <div>
                  <h3>{garden.name}</h3>
                  <p>{garden.zone || 'بدون نطاق'}</p>
                </div>
              </div>

              <div className="proof-preview">
                {draft?.imagePreview ? (
                  <img src={draft.imagePreview} alt={`إثبات ${garden.name}`} />
                ) : (
                  <div className="empty-preview"><ImageIcon size={32} /><span>لا توجد صورة</span></div>
                )}
              </div>

              <div className="status-row">
                {status === 'ready' && <span className="status success"><CheckCircle2 size={15} /> جاهزة للإرسال</span>}
                {status === 'missing-location' && <span className="status warning"><MapPin size={15} /> الصورة جاهزة والموقع ناقص</span>}
                {status === 'empty' && <span className="status muted"><XCircle size={15} /> لم يتم التجهيز</span>}
                {status === 'failed' && <span className="status danger"><XCircle size={15} /> يحتاج مراجعة</span>}
              </div>

              {draft?.note && <p className="garden-note">{draft.note}</p>}

              <div className="garden-actions">
                <label className="action-btn upload">
                  <Camera size={17} />
                  {draft?.imagePreview ? 'تغيير الصورة' : 'رفع صورة'}
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => handleImage(garden.id, e.target.files?.[0])} />
                </label>

                <button className="action-btn location" onClick={() => handleLocation(garden.id)}>
                  <LocateFixed size={17} />
                  {draft?.location ? 'تحديث الموقع' : 'جلب الموقع'}
                </button>
              </div>

              <div className="garden-footer">
                {mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer">فتح الموقع</a> : <span>الموقع غير محفوظ</span>}
                {draft && <button onClick={() => clearGarden(garden.id)}>مسح</button>}
              </div>
            </article>
          );
        })}
      </section>

      <section className="submit-dock">
        <div>
          <strong>{readyCount} حديقة جاهزة</strong>
          <span>سيتم إرسال الحدائق التي تحتوي على صورة، ويفضل إضافة الموقع لكل حديقة.</span>
        </div>
        <button onClick={submitReport} disabled={loading || !readyCount}>
          {loading ? <Loader2 className="spin" size={18} /> : <CloudUpload size={18} />}
          إرسال التقرير
        </button>
      </section>

      {result && (
        <section className={`result-toast ${result.ok ? 'success' : 'danger'}`}>
          <strong>{result.ok ? 'تمت العملية' : 'تعذر الإرسال'}</strong>
          <p>{result.message}</p>
          <small>{result.ok ? 'تم استقبال نتيجة الإرسال.' : 'لم يتم حفظ التقرير.'}</small>
        </section>
      )}
    </main>
  );
}
