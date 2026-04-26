'use client';

import { X, CheckCircle2 } from 'lucide-react';
import { SubmitResult } from '@/lib/api';

export function ResultModal({ result, onClose }: { result: SubmitResult | null; onClose: () => void }) {
  if (!result) return null;
  return (
    <div className="modal-backdrop">
      <div className="result-modal">
        <button className="close-btn" onClick={onClose}><X size={20} /></button>
        <div className="result-icon"><CheckCircle2 size={34} /></div>
        <h2>{result.ok ? 'نتيجة الإرسال' : 'تعذر الإرسال'}</h2>
        <p>{result.message}</p>
        <div className="result-grid">
          <div><strong>{result.sent}</strong><span>ناجحة</span></div>
          <div><strong>{result.duplicates}</strong><span>مكررة</span></div>
          <div><strong>{result.failed}</strong><span>فاشلة</span></div>
        </div>
      </div>
    </div>
  );
}
