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
  imagePreviews?: string[];
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

type BasicReview = {
  status: 'passed' | 'needs_review' | 'rejected' | 'pending';
  score: number;
  reason: string;
  flags: string[];
};

type PreparedImage = {
  dataUrl: string;
  blob: Blob;
  extension: string;
  hash: string;
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

function uniqueImages(images: string[]) {
  return Array.from(new Set(images.filter(Boolean)));
}

async function sha256Blob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function prepareImages(images: string[]): Promise<PreparedImage[]> {
  const prepared: PreparedImage[] = [];

  for (const imageData of images) {
    const blob = base64ToBlob(imageData);
    const extension = getFileExtension(imageData);
    const hash = await sha256Blob(blob);
    prepared.push({ dataUrl: imageData, blob, extension, hash });
  }

  return prepared;
}

function buildBasicReview(
  record: ReportRecord,
  images: string[],
  duplicateHashCount: number
): BasicReview {
  const flags: string[] = [];
  let score = 100;

  if (!images.length) {
    flags.push('لا توجد صورة مرفوعة');
    score -= 60;
  }

  if (!record.location?.lat || !record.location?.lng) {
    flags.push('الموقع غير محفوظ');
    score -= 35;
  }

  if (typeof record.location?.accuracy === 'number' && record.location.accuracy > 300) {
    flags.push(`دقة الموقع ضعيفة: ${Math.round(record.location.accuracy)} متر`);
    score -= 10;
  }

  if (images.length > 1 && uniqueImages(images).length < images.length) {
    flags.push('توجد صورة مكررة ضمن نفس الحديقة');
    score -= 15;
  }

  if (duplicateHashCount > 0) {
    flags.push(`الصورة مكررة ومستخدمة سابقًا في سجل آخر (${duplicateHashCount})`);
    score -= 35;
  }

  score = Math.max(0, Math.min(100, score));

  if (score >= 70) {
    return {
      status: 'passed',
      score,
      reason: flags.length ? flags.join('، ') : 'تم التحقق الأساسي بنجاح',
      flags,
    };
  }

  if (score >= 40) {
    return {
      status: 'needs_review',
      score,
      reason: flags.join('، ') || 'يحتاج مراجعة',
      flags,
    };
  }

  return {
    status: 'rejected',
    score,
    reason: flags.join('، ') || 'اشتباه قوي',
    flags,
  };
}

export async function submitIrrigationReport(payload: SubmitPayload): Promise<SubmitResult> {
  const recordsWithImage = payload.records.filter((record) => {
    const images = record.imagePreviews?.length
      ? record.imagePreviews
      : record.imagePreview
        ? [record.imagePreview]
        : [];
    return images.length > 0;
  });

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
  let needsReview = 0;
  let rejected = 0;
  const reportDate = todayDate();

  for (const record of recordsWithImage) {
    const images = record.imagePreviews?.length
      ? record.imagePreviews
      : record.imagePreview
        ? [record.imagePreview]
        : [];

    let preparedImages: PreparedImage[] = [];

    try {
      preparedImages = await prepareImages(images);
    } catch {
      failed += 1;
      continue;
    }

    const imageHashes = preparedImages.map((image) => image.hash);
    let duplicateHashCount = 0;

    if (imageHashes.length) {
      const { data: duplicateRows } = await supabase
        .from('photos')
        .select('id, image_hash')
        .in('image_hash', imageHashes);

      duplicateHashCount = duplicateRows?.length || 0;
    }

    const review = buildBasicReview(record, images, duplicateHashCount);

    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        project_id: project.id,
        garden_id: record.gardenId,
        worker_name: payload.managerName || 'مدير المشروع',
        status: 'watered',
        latitude: record.location?.lat ?? null,
        longitude: record.location?.lng ?? null,
        location_accuracy: record.location?.accuracy ?? null,
        notes: record.note ?? null,
        report_date: reportDate,
        ai_review_status: review.status,
        ai_review_score: review.score,
        ai_review_reason: review.reason,
        ai_flags: review.flags,
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
      const photoRows: { report_id: string; file_url: string; image_hash: string }[] = [];

      for (let index = 0; index < preparedImages.length; index += 1) {
        const image = preparedImages[index];
        const filePath = `${project.slug}/${reportDate}/${record.gardenId}-${Date.now()}-${index}.${image.extension}`;

        const { error: uploadError } = await supabase.storage
          .from('watering-proofs')
          .upload(filePath, image.blob, {
            contentType: image.blob.type,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { data: publicUrl } = supabase.storage
          .from('watering-proofs')
          .getPublicUrl(filePath);

        photoRows.push({
          report_id: report.id,
          file_url: publicUrl.publicUrl,
          image_hash: image.hash,
        });
      }

      if (photoRows.length) {
        const { error: photoError } = await supabase.from('photos').insert(photoRows);

        if (photoError) {
          throw photoError;
        }
      }

      if (review.status === 'needs_review') needsReview += 1;
      if (review.status === 'rejected') rejected += 1;
      sent += 1;
    } catch {
      await supabase.from('photos').delete().eq('report_id', report.id);
      await supabase.from('reports').delete().eq('id', report.id);
      failed += 1;
    }
  }

  return {
    ok: sent > 0,
    message: `تم إرسال ${sent} حديقة بنجاح. تنبيهات التحقق الذكي: ${needsReview} تحتاج مراجعة، ${rejected} اشتباه قوي. المكرر: ${duplicates}، الفشل: ${failed}.`,
    sent,
    duplicates,
    failed,
  };
}
