// Local acceptance instrumentation only. Never imported by src/ or a build entry.
export type NetworkMetadata = {
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: number;
};

export function sanitizedPath(value: string): string {
  try {
    // Discard the origin, credentials, query and fragment immediately. Opaque,
    // encoded and email-like path segments are not useful acceptance evidence.
    const path = new URL(value, 'http://localhost:3000').pathname;
    return path.split('/').map(segment => (
      segment.length > 64 || /[%@=]|[a-f\d]{24,}|^[a-f\d-]{36}$/i.test(segment)
        ? ':redacted' : segment
    )).join('/').slice(0, 300);
  } catch { return '/:invalid-url'; }
}

function safeMethod(value: string): string {
  const method = value.toUpperCase();
  return /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(method) ? method : 'OTHER';
}

export function metadataOnly(value: NetworkMetadata): NetworkMetadata {
  // Deliberately enumerate five fields. Never spread request/response objects.
  return {
    method: safeMethod(value.method), path: sanitizedPath(value.path),
    status: Number.isInteger(value.status) && value.status >= 0 && value.status <= 599 ? value.status : 0,
    duration: Number.isFinite(value.duration) ? Math.max(0, Math.round(value.duration * 100) / 100) : 0,
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : 0,
  };
}

export function observeFetch(
  original: typeof fetch,
  record: (value: NetworkMetadata) => void,
  now: () => number = () => performance.now(),
  wallClock: () => number = () => Date.now(),
): typeof fetch {
  return async function (...args: Parameters<typeof fetch>) {
    const [input, init] = args;
    const path = sanitizedPath(input instanceof Request ? input.url : String(input));
    const method = safeMethod(init?.method ?? (input instanceof Request ? input.method : 'GET'));
    const start = now();
    const timestamp = wallClock();
    // Diagnostic/storage failure must not change the application's outcome.
    const emit = (status: number) => {
      try { record(metadataOnly({ method, path, status, duration: now() - start, timestamp })); }
      catch { /* Observation is best effort; browser bootstrap exposes persistence failure. */ }
    };
    try {
      const response = await original(...args);
      emit(response.status);
      return response; // Same object, body unread, no clone, no retry.
    } catch (error) {
      emit(0);
      throw error; // Preserve the exact rejection, never log its potentially sensitive message.
    }
  };
}
