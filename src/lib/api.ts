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

export async function submitIrrigationReport(payload: SubmitPayload): Promise<SubmitResult> {
  if (!payload.records.length) {
    return {
      ok: false,
      message: 'لا توجد حدائق جاهزة للإرسال.',
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
      message: 'لم يتم العثور على المشروع داخل قاعدة البيانات. تأكد من إدخال المشاريع والحدائق في Supabase.',
      sent: 0,
      duplicates: 0,
      failed: payload.records.length,
    };
  }

  const gardenNames = payload.records.map((record) => record.gardenName);

  const { data: dbGardens, error: gardensError } = await supabase
    .from('gardens')
    .select('id, name')
    .eq('project_id', project.id)
    .in('name', gardenNames);

  if (gardensError || !dbGardens) {
    return {
      ok: false,
      message: 'تعذر قراءة الحدائق من قاعدة البيانات.',
      sent: 0,
      duplicates: 0,
      failed: payload.records.length,
    };
  }

  const gardenMap = new Map(dbGardens.map((garden) => [garden.name, garden.id]));
  let sent = 0;
  let duplicates = 0;
  let failed = 0;
  const reportDate = todayDate();

  for (const record of payload.records) {
    const gardenUuid = gardenMap.get(record.gardenName);

    if (!gardenUuid) {
      failed += 1;
      continue;
    }

    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        project_id: project.id,
        garden_id: gardenUuid,
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

    if (record.imagePreview && report?.id) {
      const { error: photoError } = await supabase.from('photos').insert({
        report_id: report.id,
        file_url: record.imagePreview,
      });

      if (photoError) {
        failed += 1;
        continue;
      }
    }

    sent += 1;
  }

  return {
    ok: sent > 0,
    message: `تم إرسال ${sent} حديقة بنجاح، ${duplicates} مكررة، ${failed} فشلت.`,
    sent,
    duplicates,
    failed,
  };
}
