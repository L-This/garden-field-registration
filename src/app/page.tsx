import { ProjectCard } from '@/components/ProjectCard';
import { projects } from '@/data/projects';
import { gardens } from '@/data/gardens';
import { ShieldCheck, Smartphone, UploadCloud } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="hero">
        <div className="hero-badge">نظام ميداني مستقل</div>
        <h1>تسجيل ري الحدائق اليومي</h1>
        <p>واجهة بسيطة للمقاول أو مدير المشروع لرفع صورة الإثبات والموقع لكل حديقة، بدون عرض بيانات الإدارة أو التقارير.</p>
        <div className="hero-features">
          <span><Smartphone size={17} /> مناسب للجوال</span>
          <span><UploadCloud size={17} /> رفع جماعي</span>
          <span><ShieldCheck size={17} /> فصل عن لوحة الإدارة</span>
        </div>
      </section>

      <section className="projects-grid">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} gardens={gardens.filter((garden) => garden.projectId === project.id)} />
        ))}
      </section>
    </main>
  );
}
