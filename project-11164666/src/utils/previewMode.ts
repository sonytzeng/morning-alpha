/**
 * Morning Alpha — Owner Preview Mode
 *
 * Allows the site owner (站方) to view full member-only content for quality
 * checking, while regular visitors still see locked previews.
 *
 * Triggers:
 * 1. Readdy.ai preview domain (readdy.ai, localhost, 127.0.0.1)
 * 2. URL query: ?ownerPreview=1  or  ?preview=owner
 * 3. localStorage: morning_alpha_owner_preview === 'true'
 */

export function isOwnerPreviewMode(): boolean {
  if (typeof window === 'undefined') return false;

  const hostname = window.location.hostname;
  const params = new URLSearchParams(window.location.search);

  const isReaddyPreview =
    hostname.includes('readdy.ai') ||
    hostname.includes('localhost') ||
    hostname.includes('127.0.0.1');

  const queryEnabled =
    params.get('ownerPreview') === '1' ||
    params.get('preview') === 'owner';

  const localStorageEnabled =
    window.localStorage.getItem('morning_alpha_owner_preview') === 'true';

  return isReaddyPreview || queryEnabled || localStorageEnabled;
}

export function enableOwnerPreviewMode(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('morning_alpha_owner_preview', 'true');
}

export function disableOwnerPreviewMode(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('morning_alpha_owner_preview');
}