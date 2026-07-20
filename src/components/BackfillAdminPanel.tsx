"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type ProjectOption = { id: string; name: string };
type GardenOption = { id: string; name: string };
type ScopeMode = "all" | "selected";

type Props = {
  openedBy: string;
  onOpened?: () => void;
};

export default function BackfillAdminPanel({ openedBy, onOpened }: Props) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [gardens, setGardens] = useState<GardenOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hours, setHours] = useState(6);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name")
      .order("name")
      .then(({ data }) => setProjects((data || []) as ProjectOption[]));
  }, []);

  useEffect(() => {
    setGardens([]);
    setSelectedIds([]);
    if (!projectId) return;

    supabase
      .from("gardens")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("active", true)
      .order("name")
      .then(({ data }) => setGardens((data || []) as GardenOption[]));
  }, [projectId]);

  const filteredGardens = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return gardens;
    return gardens.filter((garden) => garden.name.toLowerCase().includes(normalized));
  }, [gardens, query]);

  function toggleGarden(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function openBackfill() {
    setMessage("");
    if (!projectId || !reportDate) {
      setMessage("اختر المشروع وتاريخ التعويض.");
      return;
    }
    if (scopeMode === "selected" && selectedIds.length === 0) {
      setMessage("اختر حديقة واحدة على الأقل.");
      return;
    }

    setLoading(true);
    const closesAt = new Date(Date.now() + Math.max(hours, 1) * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.rpc("open_daily_report_backfill", {
      p_project_id: projectId,
      p_report_date: reportDate,
      p_closes_at: closesAt,
      p_scope_mode: scopeMode,
      p_selected_garden_ids: scopeMode === "selected" ? selectedIds : null,
      p_note: note || null,
      p_opened_by: openedBy || "مدير النظام",
    });
    setLoading(false);

    if (error) {
      const friendly = error.message.includes("REPORT_ALREADY_EXISTS")
        ? "يوجد تقرير معتمد لهذا المشروع في التاريخ المختار."
        : error.message.includes("SELECT_AT_LEAST_ONE")
          ? "اختر حديقة واحدة على الأقل."
          : error.message;
      setMessage(friendly);
      return;
    }

    setMessage(
      scopeMode === "selected"
        ? `تم فتح التعويض لـ ${selectedIds.length} حديقة مختارة.`
        : "تم فتح التعويض لكامل المواقع المجدولة في التاريخ المختار.",
    );
    onOpened?.();
  }

  return (
    <section className="backfill-admin-panel" dir="rtl">
      <header>
        <h2>فتح تقرير تعويض</h2>
        <p>يفتح التقرير مؤقتًا لتاريخ سابق، ويغلق تلقائيًا بعد الاعتماد أو انتهاء المدة.</p>
      </header>

      <div className="backfill-admin-grid">
        <label>
          <span>المشروع</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">اختر المشروع</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>

        <label>
          <span>تاريخ التقرير السابق</span>
          <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
        </label>

        <label>
          <span>مدة الفتح بالساعات</span>
          <input type="number" min={1} max={48} value={hours} onChange={(event) => setHours(Number(event.target.value))} />
        </label>
      </div>

      <div className="backfill-scope-options">
        <button type="button" className={scopeMode === "all" ? "active" : ""} onClick={() => setScopeMode("all")}>
          كامل المواقع المجدولة
        </button>
        <button type="button" className={scopeMode === "selected" ? "active" : ""} onClick={() => setScopeMode("selected")}>
          حدائق مختارة
        </button>
      </div>

      {scopeMode === "selected" && projectId && (
        <div className="backfill-garden-picker">
          <div className="backfill-picker-toolbar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الحديقة" />
            <button type="button" onClick={() => setSelectedIds(gardens.map((garden) => garden.id))}>تحديد الكل</button>
            <button type="button" onClick={() => setSelectedIds([])}>إلغاء التحديد</button>
          </div>
          <strong>تم اختيار {selectedIds.length} من {gardens.length}</strong>
          <div className="backfill-garden-list">
            {filteredGardens.map((garden) => (
              <label key={garden.id}>
                <input type="checkbox" checked={selectedIds.includes(garden.id)} onChange={() => toggleGarden(garden.id)} />
                <span>{garden.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="backfill-note-field">
        <span>ملاحظة إدارية</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="سبب فتح التعويض أو أي تعليمات للمقاول" />
      </label>

      {message && <p className="backfill-admin-message">{message}</p>}
      <button type="button" className="backfill-open-button" onClick={openBackfill} disabled={loading}>
        {loading ? "جاري الفتح..." : "فتح التعويض"}
      </button>
    </section>
  );
}
