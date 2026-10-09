import type { ProgressScope, ProgressStorage } from '@/features/academy/model';

/** UI adapter: domain persistence receives opaque IDs, not titles or auth values. */
async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function createScope(identity: string, version: string, chapterIds: string[]): Promise<ProgressScope> {
  const [userId, courseVersion, courseId] = await Promise.all([digest(identity), digest(version), digest(JSON.stringify(chapterIds))]);
  return { userId, courseVersion, courseId, chapterIds };
}
export function localProgressStorage(): ProgressStorage | null {
  try {
    const storage = window.localStorage;
    return { getItem(key) { const value = storage.getItem(key); if (value && value.length > 32000) throw Error('OVERSIZED_PROGRESS'); return value; },
      setItem(key, value) { storage.setItem(key, value); } };
  } catch { return null; }
}
