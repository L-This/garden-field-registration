"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  LocateFixed,
  LockKeyhole,
  List,
  Focus,
  PartyPopper,
  MapPin,
  Search,
  ShieldCheck,
  Sprout,
  Trash2,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { submitIrrigationReport } from "@/lib/api";

type DraftStatus =
  "empty" | "ready" | "missing-location" | "sent" | "duplicate" | "failed";

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
  const [viewMode, setViewMode] = useState<"focus" | "all">("focus");
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);

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

      if (images.length && next.location) next.status = "ready";
      else if (images.length && !next.location)
        next.status = "missing-location";
      else next.status = "empty";

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

  const handleLocation = (gardenId: string) => {
    if (!navigator.geolocation) {
      updateDraft(gardenId, {
        status: "failed",
        note: "المتصفح لا يدعم تحديد الموقع",
      });
      return;
    }

    updateDraft(gardenId, { note: "جاري جلب الموقع..." });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateDraft(gardenId, {
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          note: "تم حفظ الموقع",
        });
      },
      () => {
        updateDraft(gardenId, {
          status: "failed",
          note: "تعذر جلب الموقع، تأكد من السماح للمتصفح",
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  const clearGarden = (gardenId: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[gardenId];
      return next;
    });
  };

  const readyDrafts = Object.values(drafts).filter(
    (draft) => draft.status === "ready" || draft.status === "missing-location",
  );
  const withImage = Object.values(drafts).reduce(
    (sum, draft) => sum + (draft.imagePreviews?.length || 0),
    0,
  );
  const withLocation = Object.values(drafts).filter((draft) =>
    Boolean(draft.location),
  ).length;
  const readyCount = readyDrafts.length;
  const completedCount = Object.values(drafts).filter(
    (draft) =>
      draft.status === "ready" ||
      draft.status === "missing-location" ||
      draft.status === "sent",
  ).length;
  const remainingCount = Math.max(gardens.length - completedCount, 0);
  const progress = gardens.length
    ? Math.round((completedCount / gardens.length) * 100)
    : 0;
  const allTasksCompleted = gardens.length > 0 && remainingCount === 0;
  const currentGarden = gardens[currentTaskIndex];
  const currentDraft = currentGarden ? drafts[currentGarden.id] : undefined;
  const currentTaskCompleted = Boolean(
    currentDraft &&
    ["ready", "missing-location", "sent"].includes(currentDraft.status),
  );

  const goToNextTask = () => {
    if (!currentTaskCompleted) {
      window.alert("أكمل تجهيز الموقع أولًا برفع الصور وحفظ الموقع.");
      return;
    }

    setCurrentTaskIndex((index) =>
      Math.min(index + 1, Math.max(gardens.length - 1, 0)),
    );
  };

  const goToPreviousTask = () => {
    setCurrentTaskIndex((index) => Math.max(index - 1, 0));
  };

  const filteredGardens = useMemo(() => {
    return gardens.filter((garden) => {
      const draft = drafts[garden.id];
      const matchesQuery =
        garden.name.includes(query) || Boolean(garden.zone?.includes(query));

      if (!matchesQuery) return false;
      if (filter === "ready") return draft?.status === "ready";
      if (filter === "missing") return draft?.status === "missing-location";
      if (filter === "empty") return !draft || draft.status === "empty";
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

      if (response.ok && response.sent) {
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
      setResult({
        ok: false,
        message: "تعذر إرسال التقرير. تحقق من الربط الخلفي ثم أعد المحاولة.",
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
          <span className="overview-kicker">مهام اليوم</span>
          <strong>{gardens.length}</strong>
          <small>
            {gardens.length} مهمة اليوم · {todayLabel}
          </small>
        </div>
        <div className="tasks-overview-metrics">
          <div className="metric completed">
            <span>{completedCount} تم</span>
            <strong>{completedCount}</strong>
          </div>
          <div className="metric remaining">
            <span>{remainingCount} متبقي</span>
            <strong>{remainingCount}</strong>
          </div>
          <div className="metric photos">
            <span>{withImage} صورة</span>
            <strong>{withImage}</strong>
          </div>
        </div>
      </section>

      <section className="progress-panel progress-panel-compact">
        <div>
          <h2>أنجزت</h2>
          <p>
            {allTasksCompleted
              ? "اكتملت جميع المواقع وأصبحت جاهزة للإرسال."
              : `المتبقي: ${remainingCount} مهمة`}
          </p>
        </div>
        <div className="progress-ratio">
          <strong>{completedCount}</strong>
          <span>من {gardens.length}</span>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      {allTasksCompleted ? (
        <section className="daily-completion-banner celebration-banner completion-screen">
          <div className="completion-icon">
            <PartyPopper size={42} />
          </div>
          <div className="completion-copy">
            <span className="celebration-label">أحسنت</span>
            <strong>تم إنجاز جميع مهام اليوم</strong>
            <p>
              {completedCount} من {gardens.length} — كل المواقع جاهزة للإرسال.
            </p>
          </div>
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
            إرسال التقرير
          </button>
        </section>
      ) : (
        <>
          <section className="task-view-switcher">
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

          {viewMode === "all" && (
            <section className="toolbar-card contractor-toolbar-card">
              <div className="manager-static-field">
                <span>اسم المسؤول</span>
                <strong>{managerName}</strong>
              </div>

              <div className="search-field">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث باسم الموقع أو النطاق"
                />
              </div>

              <div className="filter-pills">
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
                  ناقصة موقع
                </button>
                <button
                  onClick={() => setFilter("empty")}
                  className={filter === "empty" ? "active" : ""}
                >
                  لم تجهز
                </button>
              </div>
            </section>
          )}

          {loadingGardens ? (
            <section className="project-empty-state">
              <Loader2 className="spin" size={30} />
              <h2>جاري تحميل مهام اليوم</h2>
            </section>
          ) : (
            <section
              className={
                viewMode === "focus" ? "focused-task-area" : "gardens-list-rows"
              }
            >
              {!gardens.length ? (
                <div className="project-empty-state">
                  <CheckCircle2 size={34} />
                  <h2>لا توجد مواقع مجدولة اليوم</h2>
                  <p>
                    جدول الري لهذا المشروع لا يحتوي على مهام في يوم {todayLabel}
                    .
                  </p>
                </div>
              ) : (viewMode === "focus"
                  ? currentGarden
                    ? [currentGarden]
                    : []
                  : filteredGardens
                ).length ? (
                (viewMode === "focus"
                  ? currentGarden
                    ? [currentGarden]
                    : []
                  : filteredGardens
                ).map((garden) => {
                  const draft = drafts[garden.id];
                  const status = draft?.status || "empty";
                  const images = draft?.imagePreviews || [];
                  const mapsUrl = draft?.location
                    ? `https://www.google.com/maps?q=${draft.location.lat},${draft.location.lng}`
                    : "";

                  return (
                    <article
                      key={garden.id}
                      className={`garden-row-card ${status} ${viewMode === "focus" ? "focused-garden-card" : ""}`}
                    >
                      {viewMode === "focus" && (
                        <div className="task-navigator">
                          <div>
                            <span>
                              المهمة {currentTaskIndex + 1} من {gardens.length}
                            </span>
                            <strong>
                              {currentTaskCompleted
                                ? "المهمة جاهزة للإرسال"
                                : garden.name}
                            </strong>
                          </div>
                          <div className="task-nav-actions">
                            <button
                              onClick={goToPreviousTask}
                              disabled={currentTaskIndex === 0}
                            >
                              <ChevronRight size={18} /> السابق
                            </button>
                            <button
                              onClick={goToNextTask}
                              disabled={
                                currentTaskIndex >= gardens.length - 1 ||
                                !currentTaskCompleted
                              }
                            >
                              التالي <ChevronLeft size={18} />
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="garden-row-main">
                        <div className="garden-row-title">
                          <div className="garden-icon">
                            <Sprout size={22} />
                          </div>
                          <div>
                            <h3>{garden.name}</h3>
                            <p>{garden.zone || project.district}</p>
                          </div>
                        </div>

                        <div className="garden-row-status">
                          {status === "ready" && (
                            <span className="status success">
                              <CheckCircle2 size={15} /> جاهزة للإرسال
                            </span>
                          )}
                          {status === "missing-location" && (
                            <span className="status warning">
                              <MapPin size={15} /> الصور جاهزة والموقع ناقص
                            </span>
                          )}
                          {status === "empty" && (
                            <span className="status muted">
                              <XCircle size={15} /> لم يتم التجهيز
                            </span>
                          )}
                          {status === "failed" && (
                            <span className="status danger">
                              <XCircle size={15} /> يحتاج مراجعة
                            </span>
                          )}
                          {status === "sent" && (
                            <span className="status success">
                              <CheckCircle2 size={15} /> تم إرسال المهمة
                            </span>
                          )}
                          {draft?.note && <small>{draft.note}</small>}
                        </div>
                        {viewMode === "focus" && currentTaskCompleted && (
                          <div className="focused-ready-callout">
                            <CheckCircle2 size={20} /> جاهزة للإرسال
                          </div>
                        )}
                      </div>

                      <div className="multi-photo-strip">
                        {images.length ? (
                          images.map((src, index) => (
                            <div
                              className="multi-photo-item"
                              key={`${garden.id}-${index}`}
                            >
                              <img
                                src={src}
                                alt={`${garden.name} ${index + 1}`}
                              />
                              <button
                                onClick={() => removeImage(garden.id, index)}
                                title="حذف الصورة"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="empty-photo-row">
                            <ImageIcon size={28} />
                            <span>لا توجد صور</span>
                          </div>
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
                            onChange={(e) =>
                              handleImages(garden.id, e.target.files)
                            }
                          />
                        </label>

                        <button
                          className="action-btn location"
                          onClick={() => handleLocation(garden.id)}
                        >
                          <LocateFixed size={17} />
                          {draft?.location ? "تحديث الموقع" : "جلب الموقع"}
                        </button>

                        {mapsUrl ? (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="row-map-link"
                          >
                            فتح الموقع
                          </a>
                        ) : (
                          <span className="row-map-muted">
                            الموقع غير محفوظ
                          </span>
                        )}
                        {draft && (
                          <button
                            className="row-clear-btn"
                            onClick={() => clearGarden(garden.id)}
                          >
                            مسح
                          </button>
                        )}
                        {viewMode === "focus" &&
                          currentTaskIndex < gardens.length - 1 && (
                            <button
                              className="next-task-primary"
                              onClick={goToNextTask}
                              disabled={!currentTaskCompleted}
                            >
                              الانتقال للمهمة التالية <ChevronLeft size={18} />
                            </button>
                          )}
                        {viewMode === "focus" && !currentTaskCompleted && (
                          <small className="next-task-hint">
                            أكمل رفع الصور وحفظ الموقع لتفعيل الانتقال.
                          </small>
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
          )}
        </>
      )}

      {!allTasksCompleted && (
        <section className="submit-dock">
          <div>
            <strong>{readyCount} مهمة جاهزة للإرسال</strong>
            <span>
              {remainingCount
                ? `باقي ${remainingCount} مهمة غير مكتملة.`
                : "اكتملت مهام اليوم، ويمكن إرسال التقرير الآن."}
            </span>
          </div>
          <button onClick={submitReport} disabled={loading || !readyCount}>
            {loading ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <CloudUpload size={18} />
            )}
            إرسال التقرير
          </button>
        </section>
      )}

      {result && (
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
