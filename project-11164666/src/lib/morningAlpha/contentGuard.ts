/**
 * contentGuard — Content validation helpers for Morning Alpha
 *
 * Rules:
 * - null, undefined, empty string, "-", "—", "null", "undefined" → no content
 * - Empty arrays, empty objects → no content
 * - Sections with only title but no body → no content
 * - These rules apply to ALL pages uniformly
 */

/**
 * Check if a value has useful content for rendering.
 * Returns false for null, undefined, empty strings, placeholder-only strings,
 * empty arrays, and empty objects.
 */
export function hasUsefulContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  // String
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    // Placeholder values
    if (trimmed === '-' || trimmed === '—' || trimmed === '--' || trimmed === '---') return false;
    if (trimmed === 'null' || trimmed === 'undefined' || trimmed === 'NaN') return false;
    return true;
  }

  // Number — 0 is valid, NaN is not
  if (typeof value === 'number') {
    return !Number.isNaN(value);
  }

  // Array — empty arrays have no content
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    // Check if at least one element has useful content
    return value.some((item) => hasUsefulContent(item));
  }

  // Object — empty objects have no content
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return false;
    // Check if at least one value has useful content
    return keys.some((key) => hasUsefulContent((value as Record<string, unknown>)[key]));
  }

  // Boolean — always has content (true or false is meaningful)
  if (typeof value === 'boolean') return true;

  return false;
}

/**
 * Check if a section (object with title/content fields) has useful content.
 * A section needs BOTH a title AND content to be considered useful.
 */
export function isSectionUseful(section: Record<string, unknown> | null | undefined): boolean {
  if (!section) return false;
  const title = section.title ?? section.heading ?? section.name ?? section.key;
  const content = section.content ?? section.body ?? section.text ?? section.description ?? section.desc;
  const hasTitle = hasUsefulContent(title);
  const hasContent = hasUsefulContent(content);
  return hasTitle && hasContent;
}

/**
 * Filter an array of sections, keeping only those with useful content.
 */
export function filterUsefulSections<T extends Record<string, unknown>>(sections: T[] | null | undefined): T[] {
  if (!sections || !Array.isArray(sections)) return [];
  return sections.filter((s) => isSectionUseful(s));
}

/**
 * Filter an array, keeping only items with useful content (by specified key).
 */
export function filterUsefulItems<T>(items: T[] | null | undefined, contentKey: keyof T): T[] {
  if (!items || !Array.isArray(items)) return [];
  return items.filter((item) => hasUsefulContent(item[contentKey]));
}

/**
 * Check if an array has at least one useful item.
 */
export function hasAnyUsefulItem<T>(items: T[] | null | undefined, contentKey?: keyof T): boolean {
  if (!items || !Array.isArray(items) || items.length === 0) return false;
  if (contentKey) {
    return items.some((item) => hasUsefulContent(item[contentKey]));
  }
  return items.some((item) => hasUsefulContent(item));
}

/**
 * Placeholder patterns that should never appear in rendered UI.
 */
export const FORBIDDEN_DISPLAY_STRINGS = [
  ':reportDate',
  'undefined',
  'null',
  'NaN',
  '[object Object]',
  '會員版會強在哪裡',
  '報告尚未發布',
  '目前尚未產生可公開的盤前報告',
  '資料不足，等待盤前報告更新',
  '找不到 :reportDate 的報告',
  '了解完整判讀內容',
  '會員解鎖後',
  '訂閱後可見',
  '會員限定',
  '等待解鎖',
  '尚未產生',
  '報告尚未發布',
  '觀察 #1',
  '影響鏈 #1',
  '中性震盪',
  '55/100',
  '今日報告尚未產生',
  '尚未產生可公開的盤前報告',
] as const;

/**
 * Check if a display string is forbidden (should not appear in UI).
 */
export function isForbiddenDisplay(text: string): boolean {
  return FORBIDDEN_DISPLAY_STRINGS.some((p) => text.includes(p));
}