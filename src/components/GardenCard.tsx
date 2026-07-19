'use client';

import { Camera, RefreshCcw } from 'lucide-react';
import { Garden } from '@/data/gardens';
import { GardenDraft } from '@/lib/types';
import { fileToDataUrl } from '@/lib/image';
import { StatusPill } from './StatusPill';

export function GardenCard({
  garden,
  draft,
  onChange,
}: {
  garden: Garden;
  draft?: GardenDraft;
  onChange: (gardenId: string, draft: GardenDraft) => void;
}) {
  const current: GardenDraft = draft || { gardenId: garden.id, status: 'empty' };

  async function handleFile(file?: File) {
    if (!file) return;
    const preview = await fileToDataUrl(file);
    const nextStatus = 'ready';
    onChange(garden.id, {
      ...current,
      imageName: file.name,
      imagePreview: preview,
      status: nextStatus,
      message: undefined,
    });
  }


  return (
    <article className="garden-card">
      <div className="garden-header">
        <div>
          <h3>{garden.name}</h3>
          <p>{garden.zone || 'بدون نطاق'}</p>
        </div>
        <StatusPill draft={current} />
      </div>

      {current.imagePreview ? (
        <img className="proof-preview" src={current.imagePreview} alt={`إثبات ${garden.name}`} />
      ) : (
        <div className="empty-proof"><Camera size={24} /> لا توجد صورة إثبات</div>
      )}

      <div className="garden-actions">
        <label className="action-btn primary">
          {current.imagePreview ? <RefreshCcw size={18} /> : <Camera size={18} />}
          {current.imagePreview ? 'تغيير الصورة' : 'رفع صورة'}
          <input type="file" accept="image/*" capture="environment" onChange={(event) => handleFile(event.target.files?.[0])} />
        </label>
      </div>

      {current.message && <p className="mini-note warning">{current.message}</p>}
    </article>
  );
}
