"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudUpload,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  Search,
  ShieldCheck,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  getDailyReportContext,
  submitIrrigationReport,
  type DailyReportContext,
} from "@/lib/api";

type DraftStatus = "empty" | "ready" | "sent" | "failed";

type GardenDraft = {
  gardenId: string;
  gardenName: string;
  imagePreview?: string;
  imagePreviews?: string[];
  status: DraftStatus;
  note?: string;
};

type FieldSubmitResult = {
  ok: boolean;
  message: string;
  sent?: number;
  duplicates?: number;
  failed?: number;
  reportNumber?: string;
  submittedAt?: string;
};

type UiProject = {
  id: string;
  dbId: string;
  name: string;
  district: string;
  contractorLabel: string;
  contractorCode: string;
};

type UiGarden = { id: string; name: string };

const RIYADH_TIME_ZONE = "Asia/Riyadh";

type ScheduleDayColumn =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

function getDayColumnForDate(dateValue: string): ScheduleDayColumn {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TIME_ZONE,
    weekday: "long",
  })
    .format(new Date(`${dateValue}T12:00:00Z`))
    .toLowerCase() as ScheduleDayColumn;
}

function formatArabicDate(dateValue: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: RIYADH_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateValue}T12:00:00Z`));
}

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
  const projectId = String(params.projectId || "");

  const [project, setProject] = useState<UiProject | null>(null);
  const [context, setContext] = useState<DailyReportContext | null>(null);
  const [gardens, setGardens] = useState<UiGarden[]>([]);
  const [drafts, setDrafts] = useState<Record<string, GardenDraft>>({});
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingGardens, setLoadingGardens] = useState(false);
  const [pageError, setPageError] = useState("");

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");
  const [managerName, setManagerName] = useState("مدير المشروع");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "empty">("all");
  const [previewImage, setPreviewImage] = useState<{ gardenId: string; index: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitStage, setSubmitStage] = useState<"idle" | "uploading" | "saving" | "verifying">("idle");
  const [result, setResult] = useState<FieldSubmitResult | null>(null);

  const reportLocked = Boolean(
    context && ["submitted", "submitted_legacy", "processing"].includes(context.status),
  );

  useEffect(() => {
    async function loadProject() {
      setLoadingPage(true);
      setPageError("");
      const { data: row, error } = await supabase
        .from("projects")
        .select("id, slug, name, district, contractor_label, contractor_code, manager_name")
        .eq("slug", projectId)
        .single();

      if (error || !row) {
        setPageError("المشروع غير موجود في قاعدة البيانات.");
        setLoadingPage(false);
        return;
      }

      const loaded: UiProject = {
        id: row.slug,
        dbId: row.id,
        name: row.name,
        district: row.district || "بدون نطاق",
        contractorLabel: row.manager_name || row.contractor_label || "مدير المشروع",
        contractorCode: row.contractor_code || "123456",
      };
      setProject(loaded);
      setManagerName(loaded.contractorLabel);

      const savedAccess = sessionStorage.getItem(`field-access-${projectId}`);
      if (savedAccess) {
        try {
          const parsed = JSON.parse(savedAccess) as { code?: string; expiresAt?: number };
          if (
            parsed.code === loaded.contractorCode &&
            typeof parsed.expiresAt === "number" &&
            Date.now() < parsed.expiresAt
          ) {
            setIsUnlocked(true);
            await loadDailyState(loaded.dbId);
          }
        } catch {
          sessionStorage.removeItem(`field-access-${projectId}`);
        }
      }
      setLoadingPage(false);
    }
    if (projectId) loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!isUnlocked || !project) return;

    let busy = false;
    const refreshDailyContext = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const fresh = await getDailyReportContext(project.dbId);
        if (
          !context ||
          fresh.reportDate !== context.reportDate ||
          fresh.status !== context.status ||
          fresh.submissionId !== context.submissionId
        ) {
          await loadDailyState(project.dbId);
        }
      } catch {
        // Keep the current screen and retry on the next interval.
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(refreshDailyContext, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshDailyContext();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isUnlocked, project, context?.reportDate, context?.status, context?.submissionId]);

  async function loadDailyState(projectDbId: string) {
    setLoadingGardens(true);
    setPageError("");
    setGardens([]);
    setDrafts({});
    setResult(null);

    try {
      const dailyContext = await getDailyReportContext(projectDbId);
      setContext(dailyContext);

      if (["submitted", "submitted_legacy", "processing"].includes(dailyContext.status)) {
        setLoadingGardens(false);
        return;
      }

      const dayColumn = getDayColumnForDate(dailyContext.reportDate);
      const { data: scheduleRows, error: schedulesError } = await supabase
        .from("watering_schedules")
        .select(`garden_id, daily_watering, ${dayColumn}`)
        .eq("project_id", projectDbId)
        .or(`daily_watering.eq.true,${dayColumn}.eq.true`);
      if (schedulesError) throw schedulesError;

      const ids = Array.from(new Set((scheduleRows || []).map((row) => String(row.garden_id)).filter(Boolean)));
      if (!ids.length) {
        setLoadingGardens(false);
        return;
      }

      const { data: gardenRows, error: gardensError } = await supabase
        .from("gardens")
        .select("id, name")
        .eq("project_id", projectDbId)
        .eq("active", true)
        .in("id", ids)
        .order("created_at", { ascending: true });
      if (gardensError) throw gardensError;
      setGardens((gardenRows || []).map((garden) => ({ id: garden.id, name: garden.name })));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "تعذر تحميل حالة التقرير اليومية.");
    } finally {
      setLoadingGardens(false);
    }
  }

  async function unlockProject() {
    if (!project) return;
    if (accessCode.trim() !== project.contractorCode) {
      setAccessError(accessCode.trim() ? "رمز المرور غير صحيح" : "أدخل رمز مرور المشروع");
      return;
    }
    sessionStorage.setItem(
      `field-access-${projectId}`,
      JSON.stringify({ code: project.contractorCode, expiresAt: Date.now() + 60 * 60 * 1000 }),
    );
    setIsUnlocked(true);
    setAccessError("");
    await loadDailyState(project.dbId);
  }

  function updateDraft(gardenId: string, images: string[]) {
    const garden = gardens.find((item) => item.id === gardenId);
    if (!garden) return;
    setDrafts((current) => ({
      ...current,
      [gardenId]: {
        gardenId,
        gardenName: garden.name,
        imagePreviews: images,
        imagePreview: images[0],
        status: images.length ? "ready" : "empty",
        note: images.length ? `تم رفع ${images.length} ${images.length === 1 ? "صورة" : "صور"}` : undefined,
      },
    }));
  }

  async function handleImages(gardenId: string, files?: FileList | null) {
    if (!files?.length) return;
    const newImages = await Promise.all(Array.from(files).map(fileToBase64));
    const previous = drafts[gardenId]?.imagePreviews || [];
    updateDraft(gardenId, [...previous, ...newImages]);
  }

  function removeImage(gardenId: string, index: number) {
    const images = (drafts[gardenId]?.imagePreviews || []).filter((_, imageIndex) => imageIndex !== index);
    updateDraft(gardenId, images);
    if (previewImage?.gardenId === gardenId) setPreviewImage(null);
  }

  const readyCount = Object.values(drafts).filter((draft) => draft.status === "ready").length;
  const imageCount = Object.values(drafts).reduce((sum, draft) => sum + (draft.imagePreviews?.length || 0), 0);
  const remainingCount = Math.max(gardens.length - readyCount, 0);
  const progress = gardens.length ? Math.round((readyCount / gardens.length) * 100) : 0;
  const allReady = gardens.length > 0 && readyCount === gardens.length;

  const filteredGardens = useMemo(() => {
    return gardens.filter((garden) => {
      if (!garden.name.includes(query)) return false;
      const ready = drafts[garden.id]?.status === "ready";
      if (filter === "ready") return ready;
      if (filter === "empty") return !ready;
      return true;
    });
  }, [gardens, drafts, query, filter]);

  async function submitReport() {
    if (!context || !allReady || loading) return;
    setLoading(true);
    setResult(null);
    setSubmitStage("uploading");
    const t1 = window.setTimeout(() => setSubmitStage("saving"), 700);
    const t2 = window.setTimeout(() => setSubmitStage("verifying"), 1500);

    const response = await submitIrrigationReport({
      projectId,
      managerName,
      reportDate: context.reportDate,
      submittedAt: new Date().toISOString(),
      expectedGardens: gardens.length,
      records: gardens.map((garden) =>
        drafts[garden.id] || {
          gardenId: garden.id,
          gardenName: garden.name,
          imagePreviews: [],
          status: "empty",
        },
      ),
    });

    window.clearTimeout(t1);
    window.clearTimeout(t2);
    setLoading(false);
    setSubmitStage("idle");
    setResult(response);
    if (response.ok && project) await loadDailyState(project.dbId);
  }

  if (loadingPage) {
    return <main className="project-page field-shell"><section className="project-empty-state"><Loader2 className="spin" /><h1>جاري تحميل المشروع</h1></section></main>;
  }

  if (pageError || !project) {
    return <main className="project-page"><section className="project-empty-state"><h1>تعذر فتح المشروع</h1><p>{pageError}</p><Link href="/" className="primary-link">العودة للمشاريع</Link></section></main>;
  }

  if (!isUnlocked) {
    return (
      <main className="project-page field-shell" dir="rtl">
        <section className="project-lock-card">
          <div className="lock-icon"><LockKeyhole size={38} /></div>
          <h1>{project.name}</h1><p>{project.district}</p>
          <form onSubmit={(event) => { event.preventDefault(); unlockProject(); }}>
            <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="رمز مرور المشروع" autoFocus />
            <button type="submit">دخول المشروع</button>
          </form>
          {accessError && <span className="lock-error">{accessError}</span>}
        </section>
      </main>
    );
  }

  const dateLabel = context ? formatArabicDate(context.reportDate) : "";

  return (
    <main className="project-page field-shell" dir="rtl">
      <section className="field-hero">
        <div>
          <Link href="/" className="back-link"><ArrowLeft size={18} /> العودة للمشاريع</Link>
          <div className="hero-badge"><ShieldCheck size={16} /> نظام تسجيل ميداني</div>
          <h1>{project.name}</h1><p>{project.district}</p>
        </div>
        <div className="hero-date"><span>اسم المسؤول</span><strong>{managerName}</strong><small>{dateLabel}</small></div>
      </section>

      {context?.isBackfill && (
        <section className="daily-backfill-banner">
          <strong>فترة تعويض مفتوحة</strong>
          <span>التقرير الحالي سيُعتمد بتاريخ {dateLabel} وليس بتاريخ اليوم.</span>
        </section>
      )}

      {loadingGardens ? (
        <section className="project-empty-state"><Loader2 className="spin" /><h2>جاري فحص التقرير اليومي</h2></section>
      ) : reportLocked ? (
        <section className="daily-report-locked-card">
          {context?.status === "processing" ? <Loader2 className="spin" size={48} /> : <CheckCircle2 size={58} />}
          <h1>{context?.status === "processing" ? "التقرير قيد الإرسال" : "شكرًا، تم إنجاز المهمة"}</h1>
          <p>
            {context?.status === "processing"
              ? "يوجد إرسال جارٍ لهذا المشروع. لا يمكن بدء تقرير ثانٍ من جهاز آخر."
              : `تم اعتماد تقرير المشروع بتاريخ ${dateLabel}. تم إغلاق الرفع لهذا التاريخ على جميع الأجهزة.`}
          </p>
          {context?.reportNumber && <strong dir="ltr">{context.reportNumber}</strong>}
          {context?.status === "submitted_legacy" && <small>تم اكتشاف تقرير سابق من السجلات القديمة وحمايته من التكرار.</small>}
          <Link href="/" className="primary-link">العودة للمشاريع</Link>
        </section>
      ) : (
        <>
          <section className="tasks-overview-card quick-overview">
            <div className="tasks-overview-main"><span>مهام التقرير</span><strong>{gardens.length}</strong><small>{dateLabel}</small></div>
            <div className="tasks-overview-metrics">
              <div className="metric completed"><span>تم تجهيزها</span><strong>{readyCount}</strong></div>
              <div className="metric remaining"><span>المتبقي</span><strong>{remainingCount}</strong></div>
              <div className="metric photos"><span>الصور</span><strong>{imageCount}</strong></div>
            </div>
          </section>

          <section className="progress-panel progress-panel-compact">
            <div><h2>تقدم التقرير</h2><p>{allReady ? "اكتملت صور جميع المواقع." : `المتبقي ${remainingCount} موقعًا`}</p></div>
            <div className="progress-ratio"><strong>{readyCount}</strong><span>من {gardens.length}</span><em>{progress}%</em></div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          </section>

          <section className="quick-tools-panel">
            <div className="quick-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الموقع" /></div>
            <div className="quick-filter-buttons">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>الكل</button>
              <button className={filter === "empty" ? "active" : ""} onClick={() => setFilter("empty")}>لم تُرفع</button>
              <button className={filter === "ready" ? "active" : ""} onClick={() => setFilter("ready")}>جاهزة</button>
            </div>
          </section>

          <section className="quick-gardens-list">
            {filteredGardens.map((garden, index) => {
              const draft = drafts[garden.id];
              const images = draft?.imagePreviews || [];
              const ready = images.length > 0;
              return (
                <article key={garden.id} className={`quick-garden-row ${ready ? "ready" : ""}`}>
                  <div className="quick-garden-title"><span>{index + 1}</span><div><h3>{garden.name}</h3><small>{ready ? `جاهزة — ${images.length} ${images.length === 1 ? "صورة" : "صور"}` : "لم تُرفع صور بعد"}</small></div></div>
                  <div className="quick-garden-images">
                    {images.map((image, imageIndex) => (
                      <button key={`${garden.id}-${imageIndex}`} onClick={() => setPreviewImage({ gardenId: garden.id, index: imageIndex })} className="quick-thumb">
                        <img src={image} alt={`صورة ${garden.name}`} />
                        <ZoomIn size={15} />
                      </button>
                    ))}
                  </div>
                  <div className="quick-garden-actions">
                    <label className="quick-upload-button"><Camera size={20} /><span>{ready ? "إضافة صور" : "رفع الصور"}</span><input type="file" accept="image/*" multiple onChange={(event) => handleImages(garden.id, event.target.files)} /></label>
                    {ready && <button className="quick-clear-button" onClick={() => updateDraft(garden.id, [])}><Trash2 size={18} /> مسح الصور</button>}
                  </div>
                </article>
              );
            })}
          </section>

          {allReady && (
            <section className="quick-submit-panel">
              <CheckCircle2 size={38} /><div><h2>اكتمل التقرير</h2><p>تم تجهيز صور جميع المواقع. بعد الإرسال سيُغلق هذا التاريخ على جميع الأجهزة.</p></div>
              <button onClick={submitReport} disabled={loading}><CloudUpload size={21} /> إرسال التقرير واعتماد اليوم</button>
            </section>
          )}
        </>
      )}

      {loading && submitStage !== "idle" && (
        <div className="submit-progress-overlay"><div className="submit-progress-card"><Loader2 className="spin" size={38} /><strong>جاري اعتماد التقرير اليومي</strong><div className="submit-progress-steps"><span className="active">رفع الصور...</span><span className={submitStage !== "uploading" ? "active" : ""}>حفظ البيانات...</span><span className={submitStage === "verifying" ? "active" : ""}>التحقق وإغلاق اليوم...</span></div></div></div>
      )}

      {result && !result.ok && <section className="result-toast danger"><strong>تعذر اعتماد التقرير</strong><p>{result.message}</p></section>}

      {previewImage && (() => {
        const images = drafts[previewImage.gardenId]?.imagePreviews || [];
        const image = images[previewImage.index];
        if (!image) return null;
        return (
          <div className="field-lightbox" onClick={() => setPreviewImage(null)}>
            <button className="field-lightbox-close"><X /></button>
            <img src={image} alt="معاينة الصورة" onClick={(event) => event.stopPropagation()} />
            <button className="field-lightbox-delete" onClick={(event) => { event.stopPropagation(); removeImage(previewImage.gardenId, previewImage.index); }}><Trash2 size={18} /> حذف الصورة</button>
          </div>
        );
      })()}
    </main>
  );
}
