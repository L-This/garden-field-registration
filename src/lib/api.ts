import { supabase } from './supabase';

type LocationPoint = {
  lat: number;
  lng: number;
  accuracy?: number;
};

type ReportRecord = {
  gardenId: string;
  gardenName: string;
  imagePreview?: string;
  location?: LocationPoint;
  status?: string;
  note?: string;
};

export type SubmitResult = {
  ok: boolean;
  message: string;
  sent: number;
  duplicates: number;
  failed: number;
};

type SubmitPayload = {
  projectId: string;
  managerName: string;
  submittedAt: string;
  records: ReportRecord[];
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function base64ToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function getFileExtension(dataUrl: string) {
  const mime = dataUrl.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

export async function submitIrrigationReport(payload: SubmitPayload): Promise<SubmitResult> {
  const recordsWithImage = payload.records.filter((record) => Boolean(record.imagePreview));

  if (!recordsWithImage.length) {
    return {
      ok: false,
      message: 'لا توجد حدائق تحتوي على صورة للإرسال.',
      sent: 0,
      duplicates: 0,
      failed: 0,
    };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, slug, name')
    .eq('slug', payload.projectId)
    .single();

  if (projectError || !project) {
    return {
      ok: false,
      message: 'لم يتم العثور على المشروع داخل قاعدة البيانات.',
      sent: 0,
      duplicates: 0,
      failed: recordsWithImage.length,
    };
  }

  let sent = 0;
  let duplicates = 0;
  let failed = 0;
  const reportDate = todayDate();

  for (const record of recordsWithImage) {
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        project_id: project.id,
        garden_id: record.gardenId,
        worker_name: payload.managerName || 'مدير المشروع',
        status: 'sent',
        latitude: record.location?.lat ?? null,
        longitude: record.location?.lng ?? null,
        notes: record.note ?? null,
        report_date: reportDate,
      })
      .select('id')
      .single();

    if (reportError) {
      if (reportError.code === '23505') {
        duplicates += 1;
      } else {
        failed += 1;
      }
      continue;
    }

    try {
      const extension = getFileExtension(record.imagePreview || '');
      const blob = base64ToBlob(record.imagePreview || '');
      const filePath = `${project.slug}/${reportDate}/${record.gardenId}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('watering-proofs')
        .upload(filePath, blob, {
          contentType: blob.type,
          upsert: false,
        });

      if (uploadError) {
        failed += 1;
        continue;
      }

      const { data: publicUrl } = supabase.storage
        .from('watering-proofs')
        .getPublicUrl(filePath);

      const { error: photoError } = await supabase.from('photos').insert({
        report_id: report.id,
        file_url: publicUrl.publicUrl,
      });

      if (photoError) {
        failed += 1;
        continue;
      }

      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    ok: sent > 0,
    message: `تم إرسال ${sent} حديقة بنجاح، ${duplicates} مكررة، ${failed} فشلت.`,
    sent,
    duplicates,
    failed,
  };
}
