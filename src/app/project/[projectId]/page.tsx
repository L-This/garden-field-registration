'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search, CalendarDays } from 'lucide-react';
import { getProject } from '@/data/projects';
import { getGardensByProject } from '@/data/gardens';
import { GardenCard } from '@/components/GardenCard';
import { SubmitBar } from '@/components/SubmitBar';
import { ResultModal } from '@/components/ResultModal';
import { GardenDraft } from '@/lib/types';
import { clearDraft, loadDraft, saveDraft } from '@/lib/storage';
import { submitIrrigationReport, SubmitResult } from '@/lib/api';

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  const project = getProject(params.projectId);
  const gardens = useMemo(() => getGardensByProject(params.projectId), [params.projectId]);
  const [drafts, setDrafts] = useState<Record<string, GardenDraft>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'ready' | 'missing' | 'empty'>('all');
  const [managerName, setManagerName] = useState('مدير المشروع');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    setDrafts(loadDraft(params.projectId));
  }, [params.projectId]);

  useEffect(() => {
    saveDraft(params.projectId, drafts);
  }, [drafts, params.projectId]);

  if (!project) {
    return (
      <main className="project-page"><h1>المشروع غير موجود</h1><Link href="/">العودة للرئيسية</Link></main>
    );
  }

  const projectId = project.id;
  const readyCount = Object.values(drafts).filter((draft) => draft.status === 'ready' || draft.status === 'missing-location').length;
  const withImage = Object.values(drafts).filter((draft) => Boolean(draft.imagePreview)).length;
  const withLocation = Object.values(drafts).filter((draft) => Boolean(draft.location)).length;

  const filteredGardens = gardens.filter((garden) => {
    const draft = drafts[garden.id];
    const textMatch = garden.name.includes(query) || garden.zone?.includes(query);
    if (!textMatch) return false;
    if (filter === 'ready') return draft?.status === 'ready';
    if (filter === 'missing') return draft?.status === 'missing-location';
    if (filter === 'empty') return !draft || draft.status === 'empty';
    return true;
  });

  function updateDraft(gardenId: string, draft: GardenDraft) {
    setDrafts((current) => ({ ...current, [gardenId]: draft }));
  }

  async function handleSubmit() {
    const records = Object.values(drafts).filter((draft) => draft.status === 'ready' || draft.status === 'missing-location');
    setLoading(true);
    const response = await submitIrrigationReport({
      projectId,
      managerName,
      submittedAt: new Date().toISOString(),
      records,
    });
    setLoading(false);
    setResult(response);
    if (response.ok) {
      setDrafts((current) => {
        const next = { ...current };
        records.forEach((record) => {
          next[record.gardenId] = { ...record, status: 'sent', message: 'تم الإرسال.' };
        });
        return next;
      });
    }
  }

  function handleClear() {
    clearDraft(projectId);
    setDrafts({});
  }

  return (
    <main className="project-page">
      <header className="project-topbar">
        <Link href="/" className="back-link"><ArrowRight size={18} /> العودة للمشاريع</Link>
        <div className="today-chip"><CalendarDays size={17} /> {new Date().toLocaleDateString('ar-SA')}</div>
      </header>

      <section className="project-hero">
        <div>
          <p className="eyebrow">تسجيل ميداني</p>
          <h1>{project.name}</h1>
          <p>{project.district} — ارفع إثبات الري لكل حديقة ثم أرسل التقرير دفعة واحدة.</p>
        </div>
        <div className="manager-box">
          <label>اسم المسؤول</label>
          <input value={managerName} onChange={(event) => setManagerName(event.target.value)} />
        </div>
      </section>

      <section className="stats-row">
        <div><strong>{gardens.length}</strong><span>إجمالي الحدائق</span></div>
        <div><strong>{readyCount}</strong><span>جاهزة للإرسال</span></div>
        <div><strong>{withImage}</strong><span>بها صورة</span></div>
        <div><strong>{withLocation}</strong><span>بها موقع</span></div>
      </section>

      <section className="toolbar">
        <div className="search-box"><Search size={18} /><input placeholder="بحث باسم الحديقة أو النطاق..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="filters">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>الكل</button>
          <button className={filter === 'ready' ? 'active' : ''} onClick={() => setFilter('ready')}>جاهزة</button>
          <button className={filter === 'missing' ? 'active' : ''} onClick={() => setFilter('missing')}>بدون موقع</button>
          <button className={filter === 'empty' ? 'active' : ''} onClick={() => setFilter('empty')}>ناقصة</button>
        </div>
      </section>

      <section className="gardens-grid">
        {filteredGardens.map((garden) => (
          <GardenCard key={garden.id} garden={garden} draft={drafts[garden.id]} onChange={updateDraft} />
        ))}
      </section>

      <SubmitBar readyCount={readyCount} totalCount={gardens.length} onSubmit={handleSubmit} onClear={handleClear} loading={loading} />
      <ResultModal result={result} onClose={() => setResult(null)} />
    </main>
  );
}
