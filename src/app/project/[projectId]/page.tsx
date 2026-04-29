'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudUpload,
  Image as ImageIcon,
  Loader2,
  LocateFixed,
  LockKeyhole,
  MapPin,
  Search,
  ShieldCheck,
  Sprout,
  Trash2,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { submitIrrigationReport } from '@/lib/api';

type DraftStatus = 'empty' | 'ready' | 'missing-location' | 'sent' | 'duplicate' | 'failed';

type GardenDraft = {
  gardenId: string;
  gardenName: string;
  imagePreview?: string;
  imagePreviews?: string[];
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
  sent?: number;
  duplicates?: number;
  failed?: number;
};

type UiProject = {
  id: string;
  dbId: string;
  name: string;
  district: string;
  contractorLabel: string;
  contractorCode: string;
  accent: string;
};

type UiGarden = {
  id: string;
  name: string;
  zone?: string;
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

  const [project, setProject] = useState<UiProject | null>(null);
  const [gardens, setGardens] = useState<UiGarden[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingGardens, setLoadingGardens] = useState(false);
  const [pageError, setPageError] = useState('');

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessError, setAccessError] = useState('');

  const [drafts, setDrafts] = useState<Record<string, GardenDraft>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'ready' | 'missing' | 'empty'>('all');
  const [managerName, setManagerName] = useState('مدير المشروع');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FieldSubmitResult | null>(null);

  useEffect(() => {
    async function loadProject() {
      setLoadingPage(true);
      setPageError('');
      setProject(null);
      setGardens([]);
      setDrafts({});
      setResult(null);
      setIsUnlocked(false);
      setAccessCode('');
      setAccessError('');

      const { data: projectRow, error: projectError } = await supabase
        .from('projects')
        .select('id, slug, name, district, contractor_label, contractor_code, accent')
        .eq('slug', projectId)
        .single();

      if (projectError || !projectRow) {
        setPageError('المشروع غير موجود في قاعدة البيانات. إذا ظهر خطأ contractor_code أضف العمود من Supabase.');
        setLoadingPage(false);
        return;
      }

      const loadedProject: UiProject = {
        id: projectRow.slug,
        dbId: projectRow.id,
        name: projectRow.name,
        district: projectRow.district || 'بدون نطاق',
        contractorLabel: projectRow.contractor_label || 'مدير المشروع',
        contractorCode: projectRow.contractor_code || '123456',
        accent: projectRow.accent || 'emerald',
      };

      setProject(loadedProject);
      setManagerName(loadedProject.contractorLabel);

      const savedAccess = sessionStorage.getItem(`field-access-${projectId}`);
      if (savedAccess) {
        try {
          const parsed = JSON.parse(savedAccess) as { code?: string; expiresAt?: number };
          const isValidSession =
            parsed.code === loadedProject.contractorCode &&
            typeof parsed.expiresAt === 'number' &&
            Date.now() < parsed.expiresAt;

          if (isValidSession) {
            setIsUnlocked(true);
            await loadGardens(loadedProject.dbId);
          } else {
            sessionStorage.removeItem(`field-access-${projectId}`);
          }
        } catch {
          if (savedAccess === loadedProject.contractorCode) {
            sessionStorage.setItem(
              `field-access-${projectId}`,
              JSON.stringify({
                code: loadedProject.contractorCode,
                expiresAt: Date.now() + 60 * 60 * 1000,
              })
            );
            setIsUnlocked(true);
            await loadGardens(loadedProject.dbId);
          } else {
            sessionStorage.removeItem(`field-access-${projectId}`);
          }
        }
      }

      setLoadingPage(false);
    }

    if (projectId) loadProject();
  }, [projectId]);

  async function loadGardens(projectDbId: string) {
    setLoadingGardens(true);

    const { data: gardenRows, error: gardensError } = await supabase
      .from('gardens')
      .select('id, name')
      .eq('project_id', projectDbId)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (gardensError) {
      setPageError('تعذر تحميل حدائق المشروع.');
      setLoadingGardens(false);
      return;
    }

    setGardens((gardenRows || []).map((garden) => ({
      id: garden.id,
      name: garden.name,
    })));

    setLoadingGardens(false);
  }

  async function unlockProject() {
    if (!project) return;

    if (!accessCode.trim()) {
      setAccessError('أدخل رمز مرور المشروع');
      return;
    }

    if (accessCode.trim() !== project.contractorCode) {
      setAccessError('رمز المرور غير صحيح');
      return;
    }

    sessionStorage.setItem(
      `field-access-${projectId}`,
      JSON.stringify({
        code: project.contractorCode,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
    );
    setIsUnlocked(true);
    setAccessError('');
    await loadGardens(project.dbId);
  }

  const updateDraft = (gardenId: string, patch: Partial<GardenDraft>) => {
    const garden = gardens.find((item) => item.id === gardenId);
    if (!garden) return;

    setDrafts((current) => {
      const previous: GardenDraft = current[gardenId] || {
        gardenId,
        gardenName: garden.name,
        imagePreviews: [],
        status: 'empty',
      };

      const next: GardenDraft = { ...previous, ...patch };
      const images = next.imagePreviews || (next.imagePreview ? [next.imagePreview] : []);

      next.imagePreviews = images;
      next.imagePreview = images[0];

      if (images.length && next.location) next.status = 'ready';
      else if (images.length && !next.location) next.status = 'missing-location';
      else next.status = 'empty';

      return { ...current, [gardenId]: next };
    });
  };

  const handleImages = async (gardenId: string, fileList?: FileList | null) => {
    if (!fileList?.length) return;

    const files = Array.from(fileList);
    const previews = await Promise.all(files.map((file) => fileToBase64(file)));
    const previousImages = drafts[gardenId]?.imagePreviews || [];
    const nextImages = [...previousImages, ...previews];

    updateDraft(gardenId, {
      imagePreviews: nextImages,
      imagePreview: nextImages[0],
      note: `تم تجهيز ${nextImages.length} صورة`,
    });
  };

  const removeImage = (gardenId: string, imageIndex: number) => {
    const previousImages = drafts[gardenId]?.imagePreviews || [];
    const nextImages = previousImages.filter((_, index) => index !== imageIndex);

    updateDraft(gardenId, {
      imagePreviews: nextImages,
      imagePreview: nextImages[0],
      note: nextImages.length ? `تم تجهيز ${nextImages.length} صورة` : 'تم إزالة الصور',
    });
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
  const withImage = Object.values(drafts).reduce((sum, draft) => sum + (draft.imagePreviews?.length || 0), 0);
  const withLocation = Object.values(drafts).filter((draft) => Boolean(draft.location)).length;
  const readyCount = readyDrafts.length;
  const progress = gardens.length ? Math.round((readyCount / gardens.length) * 100) : 0;

  const filteredGardens = useMemo(() => {
    return gardens.filter((garden) => {
      const draft = drafts[garden.id];
      const matchesQuery = garden.name.includes(query) || Boolean(garden.zone?.includes(query));

      if (!matchesQuery) return false;
      if (filter === 'ready') return draft?.status === 'ready';
      if (filter === 'missing') return draft?.status === 'missing-location';
      if (filter === 'empty') return !draft || draft.status === 'empty';
      return true;
    });
  }, [gardens, drafts, query, filter]);

  const submitReport = async () => {
    if (!readyDrafts.length) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await submitIrrigationReport({
        projectId,
        managerName,
        submittedAt: new Date().toISOString(),
        records: readyDrafts.map((draft) => ({
          ...draft,
          imagePreview: draft.imagePreviews?.[0] || draft.imagePreview,
          imagePreviews: draft.imagePreviews || [],
        })) as GardenDraft[],
      });

      setResult(response);
    } catch {
      setResult({
        ok: false,
        message: 'تعذر إرسال التقرير. تحقق من الربط الخلفي ثم أعد المحاولة.',
        sent: 0,
        duplicates: 0,
        failed: readyDrafts.length,
      });
    } finally {
      setLoading(false);
    }
  };

  if (loadingPage) {
    return (
      <main className="project-page field-shell" dir="rtl">
        <section className="project-empty-state">
          <Loader2 className="spin" size={34} />
          <h1>جاري تحميل المشروع</h1>
          <p>يتم الآن جلب بيانات المشروع من Supabase.</p>
        </section>
      </main>
    );
  }

  if (pageError || !project) {
    return (
      <main className="project-page">
        <section className="project-empty-state">
          <h1>المشروع غير موجود</h1>
          <p>{pageError || 'تأكد من رابط المشروع أو ارجع للصفحة الرئيسية.'}</p>
          <Link href="/" className="primary-link">العودة للرئيسية</Link>
        </section>
      </main>
    );
  }

  if (!isUnlocked) {
    return (
      <main className="project-page field-shell" dir="rtl">
        <section className="project-lock-card">
          <div className="lock-icon"><LockKeyhole size={38} /></div>
          <h1>{project.name}</h1>
          <p>{project.district}</p>
          <strong>أدخل رمز مرور المشروع للمتابعة</strong>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              unlockProject();
            }}
          >
            <input
              type="password"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="رمز مرور المشروع"
              autoFocus
            />
            <button type="submit">دخول المشروع</button>
          </form>

          {accessError && <span className="lock-error">{accessError}</span>}
          <Link href="/" className="primary-link">العودة للرئيسية</Link>
        </section>
      </main>
    );
  }

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
          <span>اسم المسؤول</span>
          <strong>{managerName}</strong>
          <small>{todayLabel}</small>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card"><span>إجمالي الحدائق</span><strong>{gardens.length}</strong></div>
        <div className="stat-card"><span>جاهزة للإرسال</span><strong>{readyCount}</strong></div>
        <div className="stat-card"><span>إجمالي الصور</span><strong>{withImage}</strong></div>
        <div className="stat-card"><span>مواقع محفوظة</span><strong>{withLocation}</strong></div>
      </section>

      <section className="progress-panel">
        <div>
          <h2>نسبة التجهيز اليومي</h2>
          <p>اسم المسؤول مرتبط بالمشروع تلقائيًا. جهّز الصور والمواقع ثم أرسل التقرير دفعة واحدة.</p>
        </div>
        <strong>{progress}%</strong>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="toolbar-card contractor-toolbar-card">
        <div className="manager-static-field">
          <span>اسم المسؤول</span>
          <strong>{managerName}</strong>
        </div>

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

      {loadingGardens ? (
        <section className="project-empty-state">
          <Loader2 className="spin" size={30} />
          <h2>جاري تحميل الحدائق</h2>
        </section>
      ) : (
        <section className="gardens-list-rows">
          {filteredGardens.map((garden) => {
            const draft = drafts[garden.id];
            const status = draft?.status || 'empty';
            const images = draft?.imagePreviews || [];
            const mapsUrl = draft?.location
              ? `https://www.google.com/maps?q=${draft.location.lat},${draft.location.lng}`
              : '';

            return (
              <article key={garden.id} className={`garden-row-card ${status}`}>
                <div className="garden-row-main">
                  <div className="garden-row-title">
                    <div className="garden-icon"><Sprout size={22} /></div>
                    <div>
                      <h3>{garden.name}</h3>
                      <p>{garden.zone || project.district}</p>
                    </div>
                  </div>

                  <div className="garden-row-status">
                    {status === 'ready' && <span className="status success"><CheckCircle2 size={15} /> جاهزة للإرسال</span>}
                    {status === 'missing-location' && <span className="status warning"><MapPin size={15} /> الصور جاهزة والموقع ناقص</span>}
                    {status === 'empty' && <span className="status muted"><XCircle size={15} /> لم يتم التجهيز</span>}
                    {status === 'failed' && <span className="status danger"><XCircle size={15} /> يحتاج مراجعة</span>}
                    {draft?.note && <small>{draft.note}</small>}
                  </div>
                </div>

                <div className="multi-photo-strip">
                  {images.length ? (
                    images.map((src, index) => (
                      <div className="multi-photo-item" key={`${garden.id}-${index}`}>
                        <img src={src} alt={`${garden.name} ${index + 1}`} />
                        <button onClick={() => removeImage(garden.id, index)} title="حذف الصورة">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty-photo-row"><ImageIcon size={28} /><span>لا توجد صور</span></div>
                  )}
                </div>

                <div className="garden-row-actions">
                  <label className="action-btn upload">
                    <Camera size={17} />
                    رفع صور
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleImages(garden.id, e.target.files)}
                    />
                  </label>

                  <button className="action-btn location" onClick={() => handleLocation(garden.id)}>
                    <LocateFixed size={17} />
                    {draft?.location ? 'تحديث الموقع' : 'جلب الموقع'}
                  </button>

                  {mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" className="row-map-link">فتح الموقع</a> : <span className="row-map-muted">الموقع غير محفوظ</span>}
                  {draft && <button className="row-clear-btn" onClick={() => clearGarden(garden.id)}>مسح</button>}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="submit-dock">
        <div>
          <strong>{readyCount} حديقة جاهزة</strong>
          <span>سيتم إرسال الحدائق التي تحتوي على صور، ويفضل إضافة الموقع لكل حديقة.</span>
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
          <small>
            تم: {result.sent || 0} | مكرر: {result.duplicates || 0} | فشل: {result.failed || 0}
          </small>
        </section>
      )}
    </main>
  );
}
