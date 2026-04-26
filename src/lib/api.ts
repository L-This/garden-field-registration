import { SubmissionPayload } from './types';

export type SubmitResult = {
  ok: boolean;
  sent: number;
  duplicates: number;
  failed: number;
  message: string;
};

const endpoint = process.env.NEXT_PUBLIC_FIELD_API_URL || '';

export async function submitIrrigationReport(payload: SubmissionPayload): Promise<SubmitResult> {
  if (!endpoint) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const ready = payload.records.filter((record) => record.status === 'ready' || record.status === 'missing-location');
    return {
      ok: true,
      sent: ready.length,
      duplicates: 0,
      failed: 0,
      message: 'تمت محاكاة الإرسال بنجاح. اربط NEXT_PUBLIC_FIELD_API_URL عند الانتقال للإنتاج.',
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { ok: false, sent: 0, duplicates: 0, failed: payload.records.length, message: 'تعذر إرسال التقرير.' };
  }

  return response.json();
}
