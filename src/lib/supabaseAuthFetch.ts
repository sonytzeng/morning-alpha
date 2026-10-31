import { requestWithDeadline } from '@/services/requestDeadline';

/** Bound Auth's actual transport and JSON body without changing other SDK streams. */
export function createSupabaseAuthFetch(serviceUrl: string, fetcher: typeof fetch = globalThis.fetch): typeof fetch {
  const service = new URL(serviceUrl);
  const authPath = `${service.pathname.replace(/\/$/, '')}/auth/v1`;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, service);
    if (url.origin !== service.origin || !(url.pathname === authPath || url.pathname.startsWith(`${authPath}/`))) {
      return fetcher(input, init);
    }
    const controller = new AbortController();
    const upstream = init?.signal ?? (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort();
    let deadline: AbortSignal | undefined;
    try {
      return await requestWithDeadline(async signal => {
        deadline = signal;
        deadline.addEventListener('abort', abort, { once: true });
        upstream?.addEventListener('abort', abort, { once: true });
        if (deadline.aborted || upstream?.aborted) controller.abort();
        if (controller.signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
        const response = await fetcher(input, { ...init, signal: controller.signal });
        // Auth consumes JSON; keep the deadline alive after response headers so
        // a stalled body cannot hold the SDK's session lock indefinitely.
        const body = await response.arrayBuffer();
        if (controller.signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
        const buffered = new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        Object.defineProperties(buffered, {
          url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type },
        });
        return buffered;
      });
    } finally {
      // A fetch implementation may ignore abort. Cleanup must follow the outer
      // deadline rather than wait for that abandoned callback to settle.
      deadline?.removeEventListener('abort', abort);
      upstream?.removeEventListener('abort', abort);
    }
  };
}
