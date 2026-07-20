import { supabase } from './supabase';

type ReportRecord = {
  gardenId: string;
  gardenName: string;
  imagePreview?: string;
  imagePreviews?: string[];
  status?: string;
  note?: string;
};

export type DailyReportContext = {
  reportDate: string;
  isBackfill: boolean;
  status: 'open' | 'processing' | 'submitted' | 'submitted_legacy' | 'failed';
  submissionId?: string;
  reportNumber?: string;
  submittedAt?: string;
  existingReportCount: number;
  workerName?: string;
  submittedGardens: number;
  totalPhotos: number;
  backfillWindowId?: string;
  backfillScopeMode?: 'all' | 'selected';
  backfillNote?: string;
  backfillOpenedBy?: string;
  backfillClosesAt?: string;
  allowedGardens: number;
};

export type SubmitResult = {
  ok: boolean;
  message: string;
  sent: number;
  duplicates: number;
  failed: number;
  reportNumber?: string;
  submittedAt?: string;
};

type SubmitPayload = {
  projectId: string;
  managerName: string;
  reportDate: string;
  submittedAt: string;
  expectedGardens: number;
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

const RIYADH_TIME_ZONE = 'Asia/Riyadh';

type ScheduleDayColumn =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

function getDayColumnForDate(dateValue: string): ScheduleDayColumn {
  const date = new Date(`${dateValue}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: RIYADH_TIME_ZONE,
    weekday: 'long',
  }).format(date).toLowerCase() as ScheduleDayColumn;
}

export async function getDailyReportContext(projectDbId: string): Promise<DailyReportContext> {
  const { data, error } = await supabase.rpc('field_report_context', {
    p_project_id: projectDbId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('تعذر تحديد حالة التقرير اليومية. شغّل ملف SQL المرفق أولًا.');

  return {
    reportDate: String(row.report_date),
    isBackfill: Boolean(row.is_backfill),
    status: row.submission_status,
    submissionId: row.submission_id || undefined,
    reportNumber: row.report_number || undefined,
    submittedAt: row.submitted_at || undefined,
    existingReportCount: Number(row.existing_report_count || 0),
    workerName: row.worker_name || undefined,
    submittedGardens: Number(row.submitted_gardens || row.existing_report_count || 0),
    totalPhotos: Number(row.total_photos || 0),
    backfillWindowId: row.backfill_window_id || undefined,
    backfillScopeMode: row.backfill_scope_mode || undefined,
    backfillNote: row.backfill_note || undefined,
    backfillOpenedBy: row.backfill_opened_by || undefined,
    backfillClosesAt: row.backfill_closes_at || undefined,
    allowedGardens: Number(row.allowed_gardens || 0),
  };
}

function base64ToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
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
    prepared.push({
      dataUrl: imageData,
      blob,
      extension: getFileExtension(imageData),
      hash: await sha256Blob(blob),
    });
  }
  return prepared;
}

function buildBasicReview(images: string[], duplicateHashCount: number): BasicReview {
  const flags: string[] = [];
  let score = 100;

  if (!images.length) {
    flags.push('لا توجد صورة مرفوعة');
    score -= 60;
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
  if (score >= 70) return { status: 'passed', score, reason: flags.join('، ') || 'تم التحقق الأساسي بنجاح', flags };
  if (score >= 40) return { status: 'needs_review', score, reason: flags.join('، ') || 'يحتاج مراجعة', flags };
  return { status: 'rejected', score, reason: flags.join('، ') || 'اشتباه قوي', flags };
}

async function isGardenAllowedForReport(projectId: string, gardenId: string, reportDate: string) {
  const { data, error } = await supabase.rpc('report_garden_is_allowed', {
    p_project_id: projectId,
    p_garden_id: gardenId,
    p_report_date: reportDate,
  });
  return !error && Boolean(data);
}

export async function submitIrrigationReport(payload: SubmitPayload): Promise<SubmitResult> {
  const completeRecords = payload.records.filter((record) => {
    const images = record.imagePreviews?.length
      ? record.imagePreviews
      : record.imagePreview
        ? [record.imagePreview]
        : [];
    return images.length > 0;
  });

  if (completeRecords.length !== payload.expectedGardens) {
    return {
      ok: false,
      message: `التقرير غير مكتمل. المطلوب ${payload.expectedGardens} موقعًا والمجهز ${completeRecords.length}.`,
      sent: 0,
      duplicates: 0,
      failed: Math.max(payload.expectedGardens - completeRecords.length, 0),
    };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, slug, name')
    .eq('slug', payload.projectId)
    .single();

  if (projectError || !project) {
    return { ok: false, message: 'لم يتم العثور على المشروع داخل قاعدة البيانات.', sent: 0, duplicates: 0, failed: completeRecords.length };
  }

  const { data: submissionId, error: beginError } = await supabase.rpc('begin_daily_report_submission', {
    p_project_id: project.id,
    p_report_date: payload.reportDate,
    p_worker_name: payload.managerName || 'مدير المشروع',
    p_expected_gardens: payload.expectedGardens,
  });

  if (beginError || !submissionId) {
    const duplicate = beginError?.code === '23505' || beginError?.message?.includes('ALREADY');
    return {
      ok: false,
      message: duplicate
        ? 'تم إرسال تقرير هذا المشروع لهذا التاريخ مسبقًا، لذلك تم إيقاف الإرسال المكرر.'
        : beginError?.message?.includes('IN_PROGRESS')
          ? 'يوجد إرسال آخر قيد التنفيذ لهذا المشروع. انتظر قليلًا ثم حدّث الصفحة.'
          : beginError?.message?.includes('REPORT_SCOPE_CHANGED')
            ? 'تغيّرت المواقع المفتوحة للتقرير أثناء التجهيز. حدّث الصفحة وأعد المحاولة.'
            : beginError?.message?.includes('NO_GARDENS_AVAILABLE')
              ? 'لا توجد مواقع مفتوحة لهذا التقرير.'
              : `تعذر بدء التقرير اليومي: ${beginError?.message || 'خطأ غير معروف'}`,
      sent: 0,
      duplicates: duplicate ? payload.expectedGardens : 0,
      failed: duplicate ? 0 : payload.expectedGardens,
    };
  }

  const uploadedPaths: string[] = [];
  let sent = 0;
  let failed = 0;

  try {
    for (const record of completeRecords) {
      if (!(await isGardenAllowedForReport(project.id, record.gardenId, payload.reportDate))) {
        throw new Error(`الموقع ${record.gardenName} غير مجدول في تاريخ التقرير.`);
      }

      const images = record.imagePreviews?.length
        ? record.imagePreviews
        : record.imagePreview
          ? [record.imagePreview]
          : [];
      const preparedImages = await prepareImages(images);
      const imageHashes = preparedImages.map((image) => image.hash);
      const duplicateByHash = new Map<string, any>();

      if (imageHashes.length) {
        const { data: duplicateRows } = await supabase
          .from('photos')
          .select(`id, report_id, image_hash, created_at, reports(id, garden_id, project_id, report_date)`)
          .in('image_hash', imageHashes)
          .order('created_at', { ascending: true });
        (duplicateRows || []).forEach((row: any) => {
          if (row.image_hash && !duplicateByHash.has(row.image_hash)) duplicateByHash.set(row.image_hash, row);
        });
      }

      const review = buildBasicReview(images, duplicateByHash.size);
      const { data: report, error: reportError } = await supabase
        .from('reports')
        .insert({
          daily_submission_id: submissionId,
          project_id: project.id,
          garden_id: record.gardenId,
          worker_name: payload.managerName || 'مدير المشروع',
          status: 'watered',
          notes: record.note ?? null,
          report_date: payload.reportDate,
          ai_review_status: review.status,
          ai_review_score: review.score,
          ai_review_reason: review.reason,
          ai_flags: review.flags,
        })
        .select('id')
        .single();

      if (reportError || !report) throw reportError || new Error('تعذر إنشاء سجل الموقع');

      const photoRows: any[] = [];
      for (let index = 0; index < preparedImages.length; index += 1) {
        const image = preparedImages[index];
        const filePath = `${project.slug}/${payload.reportDate}/${submissionId}/${record.gardenId}-${Date.now()}-${index}.${image.extension}`;
        const { error: uploadError } = await supabase.storage
          .from('watering-proofs')
          .upload(filePath, image.blob, { contentType: image.blob.type, upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(filePath);

        const { data: publicUrl } = supabase.storage.from('watering-proofs').getPublicUrl(filePath);
        const duplicateMatch = duplicateByHash.get(image.hash);
        const duplicateReport = Array.isArray(duplicateMatch?.reports) ? duplicateMatch.reports[0] : duplicateMatch?.reports;
        const duplicateMatchType = duplicateMatch
          ? duplicateReport?.garden_id === record.gardenId && duplicateReport?.report_date === payload.reportDate
            ? 'exact_hash_same_garden_same_day'
            : duplicateReport?.garden_id === record.gardenId
              ? 'exact_hash_same_garden_different_day'
              : 'exact_hash_different_report'
          : null;

        photoRows.push({
          report_id: report.id,
          file_url: publicUrl.publicUrl,
          image_hash: image.hash,
          duplicate_of_photo_id: duplicateMatch?.id || null,
          duplicate_match_type: duplicateMatchType,
          duplicate_match_score: duplicateMatch ? 100 : null,
        });
      }

      const { error: photoError } = await supabase.from('photos').insert(photoRows);
      if (photoError) throw photoError;
      sent += 1;
    }

    const { data: finalizeRows, error: finalizeError } = await supabase.rpc('finalize_daily_report_submission', {
      p_submission_id: submissionId,
    });
    if (finalizeError) throw finalizeError;

    const finalized = Array.isArray(finalizeRows) ? finalizeRows[0] : finalizeRows;
    return {
      ok: true,
      message: `تم إرسال تقرير ${payload.reportDate} بنجاح وإغلاق الرفع لهذا التاريخ.`,
      sent,
      duplicates: 0,
      failed: 0,
      reportNumber: finalized?.report_number,
      submittedAt: finalized?.submitted_at,
    };
  } catch (error) {
    failed = Math.max(payload.expectedGardens - sent, 1);
    if (uploadedPaths.length) await supabase.storage.from('watering-proofs').remove(uploadedPaths);
    await supabase.rpc('abort_daily_report_submission', { p_submission_id: submissionId });
    return {
      ok: false,
      message: `تم إلغاء الإرسال بالكامل ولم يُعتمد تقرير جزئي. ${error instanceof Error ? error.message : ''}`.trim(),
      sent: 0,
      duplicates: 0,
      failed,
    };
  }
}
