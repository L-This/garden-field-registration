'use client';

import { Camera, LocateFixed, RefreshCcw, CheckCircle2 } from 'lucide-react';
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
    const nextStatus = current.location ? 'ready' : 'missing-location';
    onChange(garden.id, {
      ...current,
      imageName: file.name,
      imagePreview: preview,
      status: nextStatus,
      message: undefined,
    });
  }

  function handleLocation() {
    if (!navigator.geolocation) {
      onChange(garden.id, { ...current, status: current.imagePreview ? 'missing-location' : 'empty', message: 'المتصفح لا يدعم الموقع.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange(garden.id, {
          ...current,
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          status: current.imagePreview ? 'ready' : 'empty',
          message: 'تم حفظ الموقع.',
        });
      },
      () => onChange(garden.id, { ...current, message: 'تعذر جلب الموقع. تأكد من السماح للموقع.' }),
      { enableHighAccuracy: true, timeout: 12000 }
    );
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
        <button className="action-btn" onClick={handleLocation} type="button">
          {current.location ? <CheckCircle2 size={18} /> : <LocateFixed size={18} />}
          {current.location ? 'تحديث الموقع' : 'جلب الموقع'}
        </button>
      </div>

      {current.location && <p className="mini-note">الموقع محفوظ: {current.location.lat.toFixed(5)}, {current.location.lng.toFixed(5)}</p>}
      {current.message && <p className="mini-note warning">{current.message}</p>}
    </article>
  );
}
