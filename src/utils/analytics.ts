declare global {
  interface Window {
    gtag: (...args: any[]) => void;
    dataLayer: any[];
  }
}

const GA_MEASUREMENT_ID = 'G-3V6TGJ7ZEL';

function isGaEnabled(): boolean {
  return !!GA_MEASUREMENT_ID && GA_MEASUREMENT_ID.length > 0;
}

function ensureGtag(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.gtag && typeof window.gtag === 'function';
}

/**
 * Initialize Google Analytics 4.
 * Call once on app mount. Safe to call even if GA is not configured.
 * Since gtag.js is already loaded in index.html, this only sends the initial page_view.
 */
export function initGA(): void {
  if (!isGaEnabled() || !ensureGtag()) return;

  try {
    // gtag.js is already loaded by index.html <head> script.
    // Just send the initial page_view for the first load.
    trackPageView(window.location.pathname);
  } catch {
    // GA not available, silently ignore
  }
}

/**
 * Track a page view. Call on route change.
 */
export function trackPageView(path: string): void {
  if (!isGaEnabled() || !ensureGtag()) return;

  try {
    window.gtag('event', 'page_view', {
      page_path: path,
      page_title: document.title,
    });
  } catch {
    // silently ignore
  }
}

/**
 * Track a custom event.
 * @param eventName - GA4 event name
 * @param params - Optional event parameters
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (!isGaEnabled() || !ensureGtag()) return;

  try {
    window.gtag('event', eventName, params || {});
  } catch {
    // silently ignore
  }
}