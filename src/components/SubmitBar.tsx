'use client';

import { Send, Trash2 } from 'lucide-react';

export function SubmitBar({ readyCount, totalCount, onSubmit, onClear, loading }: {
  readyCount: number;
  totalCount: number;
  onSubmit: () => void;
  onClear: () => void;
  loading: boolean;
}) {
  return (
    <div className="submit-bar">
      <div>
        <strong>{readyCount}</strong>
        <span> جاهزة من أصل {totalCount}</span>
      </div>
      <div className="submit-actions">
        <button className="ghost-btn" type="button" onClick={onClear}><Trash2 size={17} /> مسح المؤقت</button>
        <button className="send-btn" type="button" disabled={!readyCount || loading} onClick={onSubmit}>
          <Send size={18} /> {loading ? 'جاري الإرسال...' : 'إرسال التقرير'}
        </button>
      </div>
    </div>
  );
}
