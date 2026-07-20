import Link from 'next/link';
import { ArrowLeft, MapPinned, Sprout } from 'lucide-react';
import { Project } from '@/data/projects';
import { Garden } from '@/data/gardens';

export function ProjectCard({ project, gardens }: { project: Project; gardens: Garden[] }) {
  return (
    <Link className="project-card" href={`/project/${project.id}`}>
      <div className="project-icon"><Sprout size={26} /></div>

      <div className="project-content">
        <h2>{project.name}</h2>
        <p><MapPinned size={16} /> {project.district}</p>
        <div className="project-meta">
          <span>{gardens.length} حديقة</span>
          <span>تسجيل يومي</span>
        </div>
        <div className="project-entry-btn">
          دخول المشروع
          <ArrowLeft size={17} />
        </div>
      </div>

      <div className="project-arrow"><ArrowLeft size={22} /></div>
    </Link>
  );
}
