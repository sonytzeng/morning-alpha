import type { AcademyMemberCatalog } from './member';

export const ACADEMY_NAVIGATION = { to: '/academy', label: '股票學院' } as const;
export const ACADEMY_LOGIN_PATH = '/login?next=%2Facademy';

// This only labels a link. The existing server catalog and lesson RPCs remain
// the authority for access; no client tier or local progress grants access.
export function academyEntryLabel(catalog: AcademyMemberCatalog | null): string {
  if (!catalog) return '開始學習';
  return catalog.progress.some(row => catalog.chapters.some(chapter =>
    chapter.id === row.chapter_id && chapter.allowed)) ? '繼續學習' : '開始學習';
}
