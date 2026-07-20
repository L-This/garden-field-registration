'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '@/components/ProjectCard';
import { supabase } from '@/lib/supabase';
import { BarChart3, Leaf, Loader2, ShieldCheck, Smartphone, UploadCloud } from 'lucide-react';

type DbProject = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  contractor_label: string | null;
  accent: string | null;
};

type DbGarden = {
  id: string;
  project_id: string;
  name: string;
};

type UiProject = {
  id: string;
  name: string;
  district: string;
  contractorLabel: string;
  accent: string;
};

type UiGarden = {
  id: string;
  projectId: string;
  name: string;
  zone?: string;
};

export default function HomePage() {
  const [projects, setProjects] = useState<UiProject[]>([]);
  const [gardens, setGardens] = useState<UiGarden[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError('');

      const { data: projectRows, error: projectsError } = await supabase
        .from('projects')
        .select('id, slug, name, district, contractor_label, accent')
        .order('created_at', { ascending: true });

      if (projectsError) {
        setError('تعذر تحميل المشاريع من قاعدة البيانات.');
        setLoading(false);
        return;
      }

      const { data: gardenRows, error: gardensError } = await supabase
        .from('gardens')
        .select('id, project_id, name')
        .eq('active', true)
        .order('created_at', { ascending: true });

      if (gardensError) {
        setError('تعذر تحميل الحدائق من قاعدة البيانات.');
        setLoading(false);
        return;
      }

      const projectSlugByUuid = new Map(
        (projectRows || []).map((project: DbProject) => [project.id, project.slug])
      );

      setProjects(
        (projectRows || []).map((project: DbProject) => ({
          id: project.slug,
          name: project.name,
          district: project.district || 'بدون نطاق',
          contractorLabel: project.contractor_label || 'مدير المشروع',
          accent: project.accent || 'emerald',
        }))
      );

      setGardens(
        (gardenRows || []).map((garden: DbGarden) => ({
          id: garden.id,
          projectId: projectSlugByUuid.get(garden.project_id) || garden.project_id,
          name: garden.name,
        }))
      );

      setLoading(false);
    }

    loadData();
  }, []);

  const totalGardens = useMemo(() => gardens.length, [gardens]);

  return (
    <main className="home-page" dir="rtl">
      <section className="home-hero legendary-hero">
        <div className="hero-badge-home">
          <ShieldCheck size={17} />
          نظام ميداني مستقل
        </div>

        <h1>تسجيل ري الحدائق اليومي</h1>

        <p>
          واجهة بسيطة للمقاول أو مدير المشروع لرفع صورة الإثبات والموقع لكل حديقة، بدون عرض بيانات الإدارة أو التقارير.
        </p>

        <div className="hero-features">
          <span><Smartphone size={17} /> مناسب للجوال</span>
          <span><UploadCloud size={17} /> رفع جماعي</span>
          <span><ShieldCheck size={17} /> فصل عن لوحة الإدارة</span>
        </div>
      </section>

      <section className="home-summary-grid">
        <div className="home-summary-card">
          <Leaf size={24} />
          <div>
            <span>إجمالي المشاريع</span>
            <strong>{projects.length}</strong>
          </div>
        </div>

        <div className="home-summary-card">
          <BarChart3 size={24} />
          <div>
            <span>إجمالي الحدائق</span>
            <strong>{totalGardens}</strong>
          </div>
        </div>

        <div className="home-summary-card">
          <UploadCloud size={24} />
          <div>
            <span>طريقة التسجيل</span>
            <strong>يومي</strong>
          </div>
        </div>
      </section>

      {loading && (
        <section className="project-empty-state">
          <Loader2 className="spin" size={34} />
          <h1>جاري تحميل المشاريع</h1>
          <p>يتم الآن جلب البيانات من Supabase.</p>
        </section>
      )}

      {!loading && error && (
        <section className="project-empty-state">
          <h1>تعذر تحميل البيانات</h1>
          <p>{error}</p>
        </section>
      )}

      {!loading && !error && (
        <section className="projects-grid">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              gardens={gardens.filter((garden) => garden.projectId === project.id)}
            />
          ))}
        </section>
      )}
    </main>
  );
}
