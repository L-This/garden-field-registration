import { ProjectCard } from '@/components/ProjectCard';
import { projects } from '@/data/projects';
import { gardens } from '@/data/gardens';
import { BarChart3, Leaf, ShieldCheck, Smartphone, UploadCloud } from 'lucide-react';

export default function HomePage() {
  const totalGardens = gardens.length;

  return (
    <main className="home-page" dir="rtl">
      <section className="home-hero">
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
          <span>إجمالي المشاريع</span>
          <strong>{projects.length}</strong>
        </div>
        <div className="home-summary-card">
          <BarChart3 size={24} />
          <span>إجمالي الحدائق</span>
          <strong>{totalGardens}</strong>
        </div>
        <div className="home-summary-card">
          <UploadCloud size={24} />
          <span>طريقة التسجيل</span>
          <strong>يومي</strong>
        </div>
      </section>

      <section className="projects-grid">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            gardens={gardens.filter((garden) => garden.projectId === project.id)}
          />
        ))}
      </section>
    </main>
  );
}
