"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Camera,
  CheckCircle2,
  CloudUpload,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  List,
  Focus,
  PartyPopper,
  Trophy,
  Undo2,
  Clock3,
  Search,
  ShieldCheck,
  Sprout,
  Trash2,
  XCircle,
  ZoomIn,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { submitIrrigationReport } from "@/lib/api";

type DraftStatus = "empty" | "ready" | "sent" | "duplicate" | "failed";

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

const RIYADH_TIME_ZONE = "Asia/Riyadh";

type ScheduleDayColumn =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

const scheduleDayColumns: ScheduleDayColumn[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function getRiyadhDayColumn(date = new Date()): ScheduleDayColumn {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TIME_ZONE,
    weekday: "long",
  })
    .format(date)
    .toLowerCase() as ScheduleDayColumn;

  return scheduleDayColumns.includes(weekday) ? weekday : "sunday";
}

function getRiyadhTodayLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: RIYADH_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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
  const todayLabel = getRiyadhTodayLabel();

  const [project, setProject] = useState<UiProject | null>(null);
  const [gardens, setGardens] = useState<UiGarden[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingGardens, setLoadingGardens] = useState(false);
  const [pageError, setPageError] = useState("");

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");

  const [drafts, setDrafts] = useState<Record<string, GardenDraft>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "missing" | "empty">(
    "all",
  );
  const [managerName, setManagerName] = useState("مدير المشروع");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FieldSubmitResult | null>(null);
  const [viewMode, setViewMode] = useState<"focus" | "all">("all");
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState<{
    gardenId: string;
    index: number;
  } | null>(null);
  const [uploadPulseGardenId, setUploadPulseGardenId] = useState<string | null>(
    null,
  );
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [imageSuccessGardenId, setImageSuccessGardenId] = useState<string | null>(null);
  const [reviewAfterCompletion, setReviewAfterCompletion] = useState(false);
  const [submitStage, setSubmitStage] = useState<
    "idle" | "uploading" | "saving" | "verifying" | "done"
  >("idle");
  const [, setClockTick] = useState(0);
  const lightboxTouchStartX = useRef<number | null>(null);

  useEffect(() => {
    async function loadProject() {
      setLoadingPage(true);
      setPageError("");
      setProject(null);
      setGardens([]);
      setDrafts({});
      setResult(null);
      setIsUnlocked(false);
      setAccessCode("");
      setAccessError("");

      const { data: projectRow, error: projectError } = await supabase
        .from("projects")
        .select(
          "id, slug, name, district, contractor_label, contractor_code, accent, manager_name",
        )
        .eq("slug", projectId)
        .single();

      if (projectError || !projectRow) {
        setPageError(
          "المشروع غير موجود في قاعدة البيانات. إذا ظهر خطأ contractor_code أضف العمود من Supabase.",
        );
        setLoadingPage(false);
        return;
      }

      const loadedProject: UiProject = {
        id: projectRow.slug,
        dbId: projectRow.id,
        name: projectRow.name,
        district: projectRow.district || "بدون نطاق",
        contractorLabel:
          projectRow.manager_name ||
          projectRow.contractor_label ||
          "مدير المشروع",
        contractorCode: projectRow.contractor_code || "123456",
        accent: projectRow.accent || "emerald",
      };

      setProject(loadedProject);
      setManagerName(loadedProject.contractorLabel);

      const savedAccess = sessionStorage.getItem(`field-access-${projectId}`);
      if (savedAccess) {
        try {
          const parsed = JSON.parse(savedAccess) as {
            code?: string;
            expiresAt?: number;
          };
          const isValidSession =
            parsed.code === loadedProject.contractorCode &&
            typeof parsed.expiresAt === "number" &&
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
              }),
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

  useEffect(() => {
    if (!gardens.length) {
      setCurrentTaskIndex(0);
      return;
    }

    setCurrentTaskIndex((index) => Math.min(index, gardens.length - 1));
  }, [gardens.length]);

  useEffect(() => {
    if (!isUnlocked || !gardens.length || taskStartedAt) return;
    const storageKey = `field-start-${projectId}-${getRiyadhDayColumn()}`;
    const savedStart = Number(sessionStorage.getItem(storageKey));
    const start = Number.isFinite(savedStart) && savedStart > 0 ? savedStart : Date.now();
    if (!savedStart) sessionStorage.setItem(storageKey, String(start));
    setTaskStartedAt(start);
  }, [isUnlocked, gardens.length, projectId, taskStartedAt]);

  useEffect(() => {
    if (!taskStartedAt || submittedAt) return;
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [taskStartedAt, submittedAt]);

  async function loadGardens(projectDbId: string) {
    setLoadingGardens(true);
    setPageError("");

    const dayColumn = getRiyadhDayColumn();

    const { data: scheduleRows, error: schedulesError } = await supabase
      .from("watering_schedules")
      .select(`garden_id, daily_watering, ${dayColumn}`)
      .eq("project_id", projectDbId)
      .or(`daily_watering.eq.true,${dayColumn}.eq.true`);

    if (schedulesError) {
      setPageError(`تعذر تحميل جدول ري اليوم: ${schedulesError.message}`);
      setGardens([]);
      setLoadingGardens(false);
      return;
    }

    const scheduledGardenIds = Array.from(
      new Set(
        (scheduleRows || [])
          .map((row) => String(row.garden_id))
          .filter(Boolean),
      ),
    );

    if (!scheduledGardenIds.length) {
      setGardens([]);
      setDrafts({});
      setLoadingGardens(false);
      return;
    }

    const { data: gardenRows, error: gardensError } = await supabase
      .from("gardens")
      .select("id, name")
      .eq("project_id", projectDbId)
      .eq("active", true)
      .in("id", scheduledGardenIds)
      .order("created_at", { ascending: true });

    if (gardensError) {
      setPageError(`تعذر تحميل مواقع اليوم: ${gardensError.message}`);
      setGardens([]);
      setLoadingGardens(false);
      return;
    }

    setGardens(
      (gardenRows || []).map((garden) => ({
        id: garden.id,
        name: garden.name,
      })),
    );

    setDrafts((current) => {
      const allowedIds = new Set(scheduledGardenIds);
      return Object.fromEntries(
        Object.entries(current).filter(([gardenId]) =>
          allowedIds.has(gardenId),
        ),
      );
    });

    setLoadingGardens(false);
  }

  async function unlockProject() {
    if (!project) return;

    if (!accessCode.trim()) {
      setAccessError("أدخل رمز مرور المشروع");
      return;
    }

    if (accessCode.trim() !== project.contractorCode) {
      setAccessError("رمز المرور غير صحيح");
      return;
    }

    sessionStorage.setItem(
      `field-access-${projectId}`,
      JSON.stringify({
        code: project.contractorCode,
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    );
    setIsUnlocked(true);
    setAccessError("");
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
        status: "empty",
      };

      const next: GardenDraft = { ...previous, ...patch };
      const images =
        next.imagePreviews || (next.imagePreview ? [next.imagePreview] : []);

      next.imagePreviews = images;
      next.imagePreview = images[0];

      next.status = images.length ? "ready" : "empty";

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
      note: `✓ تم رفع ${nextImages.length} ${nextImages.length === 1 ? "صورة" : "صور"}`,
    });
    setUploadPulseGardenId(gardenId);
    setImageSuccessGardenId(gardenId);
    window.setTimeout(() => setImageSuccessGardenId((current) => current === gardenId ? null : current), 1100);
    window.setTimeout(
      () =>
        setUploadPulseGardenId((current) =>
          current === gardenId ? null : current,
        ),
      650,
    );
  };

  const removeImage = (gardenId: string, imageIndex: number) => {
    const previousImages = drafts[gardenId]?.imagePreviews || [];
    const nextImages = previousImages.filter(
      (_, index) => index !== imageIndex,
    );

    updateDraft(gardenId, {
      imagePreviews: nextImages,
      imagePreview: nextImages[0],
      note: nextImages.length
        ? `تم تجهيز ${nextImages.length} صورة`
        : "تم إزالة الصور",
    });
  };

  const clearGarden = (gardenId: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[gardenId];
      return next;
    });
  };

  const readyDrafts = Object.values(drafts).filter(
    (draft) => draft.status === "ready",
  );
  const withImage = Object.values(drafts).reduce(
    (sum, draft) => sum + (draft.imagePreviews?.length || 0),
    0,
  );
  const readyCount = readyDrafts.length;
  const completedCount = Object.values(drafts).filter(
    (draft) => draft.status === "ready" || draft.status === "sent",
  ).length;
  const remainingCount = Math.max(gardens.length - completedCount, 0);
  const progress = gardens.length
    ? Math.round((completedCount / gardens.length) * 100)
    : 0;
  const allTasksCompleted = gardens.length > 0 && remainingCount === 0;
  const elapsedSeconds = taskStartedAt
    ? Math.max(0, Math.floor(((submittedAt?.getTime() || Date.now()) - taskStartedAt) / 1000))
    : 0;
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const submittedTimeLabel = submittedAt
    ? new Intl.DateTimeFormat("ar-SA", { timeZone: RIYADH_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(submittedAt)
    : "";
  const currentGarden = gardens[currentTaskIndex];
  const currentDraft = currentGarden ? drafts[currentGarden.id] : undefined;
  const currentTaskCompleted = Boolean(
    currentDraft && ["ready", "sent"].includes(currentDraft.status),
  );

  const scrollToCurrentTask = () => {
    window.setTimeout(() => {
      document
        .getElementById("current-field-task")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const goToNextTask = () => {
    if (!currentTaskCompleted) {
      window.alert("ارفع صورة واحدة على الأقل قبل الانتقال.");
      return;
    }

    if (currentTaskIndex >= gardens.length - 1) return;
    setIsAdvancing(true);
    window.setTimeout(() => {
      setCurrentTaskIndex((index) => Math.min(index + 1, gardens.length - 1));
      setIsAdvancing(false);
      scrollToCurrentTask();
    }, 520);
  };

  const goToPreviousTask = () => {
    setCurrentTaskIndex((index) => Math.max(index - 1, 0));
    scrollToCurrentTask();
  };

  const filteredGardens = useMemo(() => {
    return gardens.filter((garden) => {
      const draft = drafts[garden.id];
      const matchesQuery =
        garden.name.includes(query) || Boolean(garden.zone?.includes(query));

      if (!matchesQuery) return false;
      if (filter === "ready") return draft?.status === "ready";
      if (filter === "missing") return Boolean(draft?.imagePreviews?.length) && draft?.status !== "ready";
      if (filter === "empty") return !draft || draft.status === "empty";
      return true;
    });
  }, [gardens, drafts, query, filter]);

  const submitReport = async () => {
    if (!readyDrafts.length) return;

    setLoading(true);
    setResult(null);
    setSubmitStage("uploading");

    const stageTimer1 = window.setTimeout(() => setSubmitStage("saving"), 700);
    const stageTimer2 = window.setTimeout(() => setSubmitStage("verifying"), 1500);

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

      const completedAt = new Date();
      const reportNumber = response.ok
        ? `IRR-${new Intl.DateTimeFormat("en-CA", {
            timeZone: RIYADH_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
            .format(completedAt)
            .replace(/\D/g, "")}`
        : undefined;

      setResult({ ...response, reportNumber });

      if (response.ok && response.sent) {
        setSubmitStage("done");
        setSubmittedAt(completedAt);
        setReviewAfterCompletion(false);
        const submittedIds = new Set(
          readyDrafts.map((draft) => draft.gardenId),
        );
        setDrafts((current) =>
          Object.fromEntries(
            Object.entries(current).map(([gardenId, draft]) => [
              gardenId,
              submittedIds.has(gardenId)
                ? {
                    ...draft,
                    status: "sent" as DraftStatus,
                    note: "تم إرسال المهمة بنجاح",
                  }
                : draft,
            ]),
          ),
        );
      }
    } catch {
      setSubmitStage("idle");
      setResult({
        ok: false,
        message: "تعذر إرسال التقرير. تحقق من الربط الخلفي ثم أعد المحاولة.",
        sent: 0,
        duplicates: 0,
        failed: readyDrafts.length,
      });
    } finally {
      window.clearTimeout(stageTimer1);
      window.clearTimeout(stageTimer2);
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
          <p>{pageError || "تأكد من رابط المشروع أو ارجع للصفحة الرئيسية."}</p>
          <Link href="/" className="primary-link">
            العودة للرئيسية
          </Link>
        </section>
      </main>
    );
  }

  if (!isUnlocked) {
    return (
      <main className="project-page field-shell" dir="rtl">
        <section className="project-lock-card">
          <div className="lock-icon">
            <LockKeyhole size={38} />
          </div>
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
          <Link href="/" className="primary-link">
            العودة للرئيسية
          </Link>
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
          <div className="hero-badge">
            <ShieldCheck size={16} /> نظام تسجيل ميداني
          </div>
          <h1>{project.name}</h1>
          <p>{project.district}</p>
        </div>
        <div className="hero-date">
          <span>اسم المسؤول</span>
          <strong>{managerName}</strong>
          <small>{todayLabel}</small>
        </div>
      </section>

      <section className="tasks-overview-card">
        <div className="tasks-overview-main">
          <span className="overview-kicker">📋 مهام اليوم</span>
          <strong>{gardens.length}</strong>
          <small>{todayLabel}</small>
        </div>
        <div className="tasks-overview-metrics">
          <div className="metric completed">
            <span>✅ تم</span>
            <strong>{completedCount}</strong>
          </div>
          <div className="metric remaining">
            <span>⌛ المتبقي</span>
            <strong>{remainingCount}</strong>
          </div>
          <div className="metric photos">
            <span>📷 الصور</span>
            <strong>{withImage}</strong>
          </div>
          <div className="metric duration">
            <span><Clock3 size={17} /> الوقت</span>
            <strong>{elapsedLabel}</strong>
          </div>
        </div>
      </section>

      <section className="progress-panel progress-panel-compact">
        <div>
          <h2>أنجزت</h2>
          <p>
            {allTasksCompleted
              ? "اكتملت صور جميع الحدائق وأصبحت جاهزة للإرسال."
              : `المتبقي: ${remainingCount} مهمة`}
          </p>
        </div>
        <div className="progress-ratio">
          <strong>{completedCount}</strong>
          <span>من {gardens.length}</span>
          <em>{progress}%</em>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      {allTasksCompleted && !reviewAfterCompletion ? (
        result?.ok ? (
          <section className="daily-completion-banner celebration-banner completion-screen sent-success-screen">
            <div className="completion-icon">
              <CheckCircle2 size={46} />
            </div>
            <div className="completion-copy">
              <span className="celebration-label">تم بنجاح</span>
              <strong>تم إرسال تقرير اليوم بنجاح</strong>
              <div className="completion-summary-grid sent-summary">
                <div><Sprout size={22} /><span>عدد الحدائق</span><strong>{gardens.length}</strong></div>
                <div><Camera size={22} /><span>عدد الصور</span><strong>{withImage}</strong></div>
                <div><Clock3 size={22} /><span>وقت الإرسال</span><strong>{submittedTimeLabel}</strong></div>
              </div>
              <p>تم إرسال تقرير اليوم وحفظه في النظام المركزي.</p>
              {result.reportNumber && (
                <div className="sent-report-number">
                  <span>رقم التقرير</span>
                  <strong dir="ltr">{result.reportNumber}</strong>
                </div>
              )}
              <small>شكرًا لك، تم حفظ جميع الحدائق والصور بنجاح.</small>
            </div>
            <Link href="/" className="completion-back-projects">
              <ArrowLeft size={19} /> العودة للمشاريع
            </Link>
          </section>
        ) : (
          <section className="daily-completion-banner celebration-banner completion-screen">
            <div className="completion-icon trophy-icon">
              <Trophy size={42} />
            </div>
            <div className="completion-confetti" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
            <div className="completion-copy">
              <span className="celebration-label">أحسنت</span>
              <strong>تم الانتهاء من جميع الحدائق</strong>
              <p>
                {completedCount} / {gardens.length}
              </p>
              <div className="completion-summary-grid">
                <div>
                  <Camera size={22} />
                  <span>الصور</span>
                  <strong>{withImage}</strong>
                </div>
                <div>
                  <Sprout size={22} />
                  <span>الحدائق</span>
                  <strong>{gardens.length}</strong>
                </div>
                <div>
                  <Clock3 size={22} />
                  <span>الوقت المستغرق</span>
                  <strong>{elapsedLabel}</strong>
                </div>
              </div>
              <small>
                تم تجهيز التقرير وهو جاهز للإرسال إلى النظام المركزي.
              </small>
            </div>
            <div className="completion-actions">
              <button
                className="completion-return-button"
                onClick={() => {
                  setCurrentTaskIndex(Math.max(gardens.length - 1, 0));
                  setViewMode("focus");
                  setReviewAfterCompletion(true);
                  scrollToCurrentTask();
                }}
                disabled={loading}
              >
                <Undo2 size={19} /> مراجعة آخر مهمة
              </button>
              <button
                className="completion-submit-button"
                onClick={submitReport}
                disabled={loading || !readyCount}
              >
                {loading ? (
                  <Loader2 className="spin" size={19} />
                ) : (
                  <CloudUpload size={19} />
                )}
                إرسال تقرير اليوم
              </button>
            </div>
          </section>
        )
      ) : (
        <>
          <section
            className="task-view-switcher field-tabs"
            aria-label="طريقة عرض المهام"
          >
            <button
              className={viewMode === "focus" ? "active" : ""}
              onClick={() => setViewMode("focus")}
            >
              <Focus size={18} /> <span>المهمة الحالية</span>
            </button>
            <button
              className={viewMode === "all" ? "active" : ""}
              onClick={() => setViewMode("all")}
            >
              <List size={18} /> <span>جميع المهام</span>
            </button>
          </section>

          {loadingGardens ? (
            <section className="project-empty-state">
              <Loader2 className="spin" size={30} />
              <h2>جاري تحميل مهام اليوم</h2>
            </section>
          ) : !gardens.length ? (
            <section className="project-empty-state">
              <CheckCircle2 size={34} />
              <h2>لا توجد حدائق مجدولة اليوم</h2>
              <p>
                جدول الري لهذا المشروع لا يحتوي على مهام في يوم {todayLabel}.
              </p>
            </section>
          ) : viewMode === "focus" && currentGarden ? (
            <section className="field-task-shell" id="current-field-task">
              <header className="field-task-heading">
                <div>
                  <span>المهمة الحالية</span>
                  <strong dir="ltr">
                    {currentTaskIndex + 1} / {gardens.length}
                  </strong>
                </div>
                <div className="mini-progress-wrap">
                  <div
                    className="mini-progress-ring"
                    style={
                      {
                        "--progress": `${progress * 3.6}deg`,
                      } as CSSProperties
                    }
                  >
                    <span>{progress}%</span>
                  </div>
                  <small>
                    تم إنجاز
                    <br />
                    <bdi dir="ltr">{completedCount} من {gardens.length}</bdi>
                  </small>
                </div>
              </header>

              {(() => {
                const garden = currentGarden;
                const draft = drafts[garden.id];
                const images = draft?.imagePreviews || [];
                const hasImages = images.length > 0;
                const isReady = draft?.status === "ready";
                const isSent = draft?.status === "sent";
                const stageLabel = isSent
                  ? "✅ تم الإرسال"
                  : isReady
                    ? "🟢 جاهزة للإرسال"
                    : hasImages
                      ? "🟠 جارٍ التنفيذ"
                      : "🔴 لم تبدأ";
                const stageClass = isSent
                  ? "sent"
                  : isReady
                    ? "ready"
                    : hasImages
                      ? "working"
                      : "idle";

                return (
                  <article className={`field-task-card ${stageClass}`}>
                    <div className="field-task-title">
                      <div className="task-garden-icon">
                        <Sprout size={30} />
                      </div>
                      <div>
                        <small>{project.district}</small>
                        <h2>{garden.name}</h2>
                      </div>
                      <span className={`task-stage ${stageClass}`}>
                        {stageLabel}
                      </span>
                    </div>

                    <div className="task-checklist">
                      <div className={hasImages ? "done" : ""}>
                        <span>
                          <Camera size={20} />
                        </span>
                        <strong>الصور</strong>
                        <small>
                          {hasImages
                            ? `📷 ${images.length} صورة مرفوعة`
                            : "لم تُرفع بعد"}
                        </small>
                      </div>
                    </div>

                    <div className="task-proof-area">
                      {images.length ? (
                        images.map((src, index) => (
                          <div
                            className="task-proof-thumb"
                            key={`${garden.id}-${index}`}
                          >
                            <button
                              className="task-proof-open"
                              onClick={() =>
                                setPreviewImage({ gardenId: garden.id, index })
                              }
                              title="تكبير الصورة"
                            >
                              <img
                                src={src}
                                alt={`${garden.name} ${index + 1}`}
                              />
                              <span>
                                <ZoomIn size={18} /> تكبير
                              </span>
                            </button>
                            <button
                              className="task-proof-delete"
                              onClick={() => removeImage(garden.id, index)}
                              title="حذف الصورة"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="task-proof-empty">
                          <ImageIcon size={38} />
                          <strong>لا توجد صور بعد</strong>
                          <span>ارفع صورة أو أكثر لإثبات تنفيذ المهمة</span>
                        </div>
                      )}
                    </div>

                    <div className="field-action-grid">
                      <label
                        className={`field-big-action primary ${uploadPulseGardenId === garden.id ? "upload-pulse" : ""}`}
                      >
                        <Camera size={23} />
                        <span>
                          <strong>
                            {imageSuccessGardenId === garden.id
                              ? "✓ تم رفع الصورة"
                              : hasImages
                                ? `✓ ${images.length} ${images.length === 1 ? "صورة" : "صور"}`
                                : "رفع الصور"}
                          </strong>
                          <small>
                            {hasImages
                              ? "يمكن إضافة صور أخرى"
                              : "يمكن اختيار أكثر من صورة"}
                          </small>
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) =>
                            handleImages(garden.id, e.target.files)
                          }
                        />
                      </label>
                    </div>

                    {draft?.note && (
                      <p className="field-task-note">{draft.note}</p>
                    )}

                    <footer
                      className={`field-task-footer ${isReady || isSent ? "complete" : ""}`}
                    >
                      <div className="task-footer-status">
                        {isSent ? (
                          <>
                            <CheckCircle2 size={24} />
                            <div>
                              <strong>تم إرسال هذه المهمة</strong>
                              <span>حُفظ التقرير بنجاح.</span>
                            </div>
                          </>
                        ) : isReady ? (
                          <>
                            <CheckCircle2 size={24} />
                            <div>
                              <strong>اكتملت المهمة بنجاح</strong>
                              <span>يمكنك الانتقال للحديقة التالية.</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <XCircle size={24} />
                            <div>
                              <strong>
                                ارفع صورة واحدة على الأقل
                              </strong>
                              <span>الصورة هي المتطلب الوحيد لإكمال الحديقة.</span>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="task-bottom-nav">
                        <button
                          className="secondary"
                          onClick={goToPreviousTask}
                          disabled={currentTaskIndex === 0}
                        >
                          <ChevronRight size={19} /> السابق
                        </button>
                        {currentTaskIndex < gardens.length - 1 ? (
                          <button
                            onClick={goToNextTask}
                            disabled={!currentTaskCompleted}
                          >
                            التالي <ChevronLeft size={19} />
                          </button>
                        ) : currentTaskCompleted && allTasksCompleted ? (
                          <button onClick={() => { setReviewAfterCompletion(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                            ملخص الإرسال <CloudUpload size={19} />
                          </button>
                        ) : null}
                      </div>
                    </footer>
                  </article>
                );
              })()}
            </section>
          ) : (
            <>
              <section className="compact-task-toolbar">
                <div>
                  <strong>{filteredGardens.length} مهمة</strong>
                  <span>ارفع صور كل حديقة مباشرة من القائمة</span>
                </div>
                <div className="search-field">
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث باسم الحديقة"
                  />
                </div>
                <div className="filter-pills compact">
                  <button
                    onClick={() => setFilter("all")}
                    className={filter === "all" ? "active" : ""}
                  >
                    الكل
                  </button>
                  <button
                    onClick={() => setFilter("ready")}
                    className={filter === "ready" ? "active" : ""}
                  >
                    جاهزة
                  </button>
                  <button
                    onClick={() => setFilter("missing")}
                    className={filter === "missing" ? "active" : ""}
                  >
                    جارٍ التجهيز
                  </button>
                  <button
                    onClick={() => setFilter("empty")}
                    className={filter === "empty" ? "active" : ""}
                  >
                    لم تبدأ
                  </button>
                </div>
              </section>

              <section className="compact-task-list">
                {filteredGardens.length ? (
                  filteredGardens.map((garden) => {
                    const index = gardens.findIndex(
                      (item) => item.id === garden.id,
                    );
                    const draft = drafts[garden.id];
                    const images = draft?.imagePreviews || [];
                        const isReady = draft?.status === "ready";
                    const isSent = draft?.status === "sent";
                    const statusClass = isSent
                      ? "sent"
                      : isReady
                        ? "ready"
                        : images.length
                          ? "working"
                          : "idle";
                    const statusText = isSent
                      ? "✅ تم الإرسال"
                      : isReady
                        ? "🟢 جاهزة"
                        : images.length
                          ? "🟠 جارٍ التنفيذ"
                          : "🔴 لم تبدأ";
                    return (
                      <article
                        key={garden.id}
                        className={`compact-task-row quick-photo-row ${statusClass}`}
                      >
                        <span className="compact-task-number">{index + 1}</span>
                        <span className="compact-task-copy">
                          <strong>{garden.name}</strong>
                          <small>{images.length ? `${images.length} ${images.length === 1 ? "صورة" : "صور"}` : "لم تُرفع صور بعد"}</small>
                        </span>
                        <span className={`compact-task-status ${statusClass}`}>
                          {statusText}
                        </span>
                        <div className="quick-photo-actions">
                          {images.length > 0 && (
                            <button
                              type="button"
                              className="quick-preview-button"
                              onClick={() => setPreviewImage({ gardenId: garden.id, index: 0 })}
                            >
                              <ImageIcon size={18} /> معاينة
                            </button>
                          )}
                          <label className="quick-upload-button">
                            <Camera size={18} />
                            <span>{images.length ? "إضافة صور" : "رفع صور"}</span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(event) => {
                                handleImages(garden.id, event.target.files);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {images.length > 0 && (
                            <button
                              type="button"
                              className="quick-clear-button"
                              onClick={() => clearGarden(garden.id)}
                              title="حذف صور الحديقة"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="project-empty-state">
                    <Search size={30} />
                    <h2>لا توجد نتائج مطابقة</h2>
                    <p>غيّر عبارة البحث أو اختر مرشحًا آخر.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
      {previewImage &&
        (() => {
          const gallery = drafts[previewImage.gardenId]?.imagePreviews || [];
          const currentSrc = gallery[previewImage.index];
          if (!currentSrc) return null;
          const goGallery = (direction: number) => {
            const nextIndex =
              (previewImage.index + direction + gallery.length) %
              gallery.length;
            setPreviewImage({ ...previewImage, index: nextIndex });
          };
          return (
            <div
              className="image-lightbox"
              role="dialog"
              aria-modal="true"
              onClick={() => setPreviewImage(null)}
              onTouchStart={(event) => {
                lightboxTouchStartX.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                const startX = lightboxTouchStartX.current;
                const endX = event.changedTouches[0]?.clientX;
                lightboxTouchStartX.current = null;
                if (startX == null || endX == null || gallery.length < 2)
                  return;
                const delta = endX - startX;
                if (Math.abs(delta) < 45) return;
                goGallery(delta > 0 ? -1 : 1);
              }}
            >
              <button
                className="image-lightbox-close"
                onClick={() => setPreviewImage(null)}
                aria-label="إغلاق"
              >
                <X size={24} />
              </button>
              <div className="lightbox-counter">
                {previewImage.index + 1} / {gallery.length}
              </div>
              {gallery.length > 1 && (
                <button
                  className="lightbox-nav previous"
                  onClick={(e) => {
                    e.stopPropagation();
                    goGallery(-1);
                  }}
                >
                  <ChevronRight size={30} />
                </button>
              )}
              <img
                src={currentSrc}
                alt="معاينة الصورة بالحجم الكبير"
                onClick={(event) => event.stopPropagation()}
              />
              {gallery.length > 1 && (
                <button
                  className="lightbox-nav next"
                  onClick={(e) => {
                    e.stopPropagation();
                    goGallery(1);
                  }}
                >
                  <ChevronLeft size={30} />
                </button>
              )}
              <button
                className="lightbox-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeImage(previewImage.gardenId, previewImage.index);
                  if (gallery.length <= 1) setPreviewImage(null);
                  else
                    setPreviewImage({
                      ...previewImage,
                      index: Math.max(0, previewImage.index - 1),
                    });
                }}
              >
                <Trash2 size={19} /> حذف الصورة
              </button>
            </div>
          );
        })()}

      {isAdvancing && (
        <div className="task-transition-overlay">
          <div>
            <CheckCircle2 size={48} />
            <strong>تم تجهيز الحديقة</strong>
            <span>جاري فتح المهمة التالية...</span>
          </div>
        </div>
      )}

      {loading && submitStage !== "idle" && (
        <div className="submit-progress-overlay" role="status" aria-live="polite">
          <div className="submit-progress-card">
            <Loader2 className="spin" size={42} />
            <strong>جاري إرسال تقرير اليوم</strong>
            <div className="submit-progress-steps">
              <span className={submitStage === "uploading" || submitStage === "saving" || submitStage === "verifying" || submitStage === "done" ? "active" : ""}>رفع الصور...</span>
              <span className={submitStage === "saving" || submitStage === "verifying" || submitStage === "done" ? "active" : ""}>حفظ البيانات...</span>
              <span className={submitStage === "verifying" || submitStage === "done" ? "active" : ""}>التحقق من التقرير...</span>
            </div>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <section className={`result-toast ${result.ok ? "success" : "danger"}`}>
          <strong>{result.ok ? "تمت العملية" : "تعذر الإرسال"}</strong>
          <p>{result.message}</p>
          <small>
            تم: {result.sent || 0} | مكرر: {result.duplicates || 0} | فشل:{" "}
            {result.failed || 0}
          </small>
        </section>
      )}
    </main>
  );
}
