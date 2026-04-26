'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { getProject } from '@/data/projects';
import { getGardensByProject } from '@/data/gardens';

export default function ProjectPage() {
  const params = useParams();
  const projectId = String(params.projectId || '');
  const project = getProject(projectId);
  const gardens = useMemo(() => getGardensByProject(projectId), [projectId]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
  }, [projectId]);

  if (!project) {
    return (
      <main className="project-page">
        <h1>المشروع غير موجود</h1>
        <Link href="/">العودة للرئيسية</Link>
      </main>
    );
  }

  const filtered = gardens.filter(g => g.name.includes(query));

  return (
    <main className="project-page">
      <h1>{project.name}</h1>
      <p>{project.district}</p>
      <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="بحث عن حديقة" />
      <div>
        {filtered.map((g) => (
          <div key={g.id}>{g.name}</div>
        ))}
      </div>
      <Link href="/">العودة للرئيسية</Link>
    </main>
  );
}
