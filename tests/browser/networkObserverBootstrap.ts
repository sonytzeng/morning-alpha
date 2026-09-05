import { metadataOnly, observeFetch, sanitizedPath } from './networkObserver';
import type { NetworkMetadata } from './networkObserver';

// Only the explicit serve-only test config injects this module, without query flags.
if (!import.meta.env.DEV || window.location.origin !== 'http://localhost:3000') {
  throw new Error('Network observer is localhost test-only');
}

const STORAGE_KEY = 'ma:pr100:network-metadata-only:v1';
const MAX_ROWS = 10000;
let storageAvailable = true;
let overflow = false;
let rows: NetworkMetadata[] = [];
try {
  const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(stored)) rows = stored.filter((row): row is NetworkMetadata => (
    row !== null && typeof row === 'object'
    && typeof row.method === 'string' && typeof row.path === 'string'
    && typeof row.status === 'number' && typeof row.duration === 'number' && typeof row.timestamp === 'number'
  )).map(metadataOnly).slice(0, MAX_ROWS);
} catch { storageAvailable = false; }

const report = document.getElementById('network-metadata-report');
function render() {
  if (!report) return;
  // Plain text only; this local report contains no application payload or identity.
  report.textContent = JSON.stringify({ storageAvailable, overflow, rows }, null, 2);
}
function record(value: NetworkMetadata) {
  if (rows.length >= MAX_ROWS) overflow = true;
  else rows.push(metadataOnly(value));
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); }
  catch { storageAvailable = false; }
  render();
}

window.fetch = observeFetch(window.fetch.bind(window), record);

// Native resources (HTML, scripts, CSS, fonts) do not pass through fetch().
// Capture their browser-reported status/timing, not their contents. Status 0 is
// explicitly UNKNOWN (opaque cross-origin resource), never asserted to be 200.
function resource(entry: PerformanceEntry) {
  if (!(entry instanceof PerformanceResourceTiming)) return;
  if (entry.entryType === 'navigation' && entry.duration === 0) return; // Not complete yet.
  if (entry.initiatorType === 'fetch') return; // Already captured with real Response.status.
  record({ method: entry.initiatorType === 'xmlhttprequest' ? 'OTHER' : 'GET',
    path: sanitizedPath(entry.name), status: entry.responseStatus,
    duration: entry.duration, timestamp: performance.timeOrigin + entry.startTime });
}
const resources = new PerformanceObserver(list => list.getEntries().forEach(resource));
resources.observe({ type: 'resource', buffered: true });
const navigation = new PerformanceObserver(list => list.getEntries().forEach(resource));
navigation.observe({ type: 'navigation', buffered: true });
document.getElementById('reset-network-metadata')?.addEventListener('click', () => {
  rows = []; overflow = false;
  try { sessionStorage.setItem(STORAGE_KEY, '[]'); } catch { storageAvailable = false; }
  render();
});
render();
