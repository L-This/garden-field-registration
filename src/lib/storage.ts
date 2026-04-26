import { GardenDraft } from './types';

const prefix = 'garden-field-registration';

export function loadDraft(projectId: string): Record<string, GardenDraft> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(`${prefix}:${projectId}`) || '{}');
  } catch {
    return {};
  }
}

export function saveDraft(projectId: string, drafts: Record<string, GardenDraft>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${prefix}:${projectId}`, JSON.stringify(drafts));
}

export function clearDraft(projectId: string) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`${prefix}:${projectId}`);
}
