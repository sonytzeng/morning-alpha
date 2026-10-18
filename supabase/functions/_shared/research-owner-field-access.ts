/** Additive Reader field only: never changes existing membership or report access. */
export const RESEARCH_OWNER_FIELD_DEADLINE_MS = 2_000;

type OwnerClient = {
  auth: { getUser: (jwt: string) => PromiseLike<{
    data: { user: { id: string } | null } | null; error: unknown;
  }> };
  rpc: (name: string) => { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
};
type UserClientOptions = {
  auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false };
  global: { headers: { Authorization: string }; fetch: typeof fetch };
};

export async function canReadResearchOwnerFields(input: {
  request: Request; tier: string; userId: string | null; supabaseUrl: string; anonKey: string;
  createClient: (url: string, key: string, options: UserClientOptions) => OwnerClient;
}): Promise<boolean> {
  if (input.tier !== 'admin' || !input.userId || !input.supabaseUrl || !input.anonKey) return false;
  const authorization = input.request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || input.request.signal.aborted) return false;

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, input.request.signal]);
  const deadline = performance.now() + RESEARCH_OWNER_FIELD_DEADLINE_MS;
  const expired = () => signal.aborted || performance.now() >= deadline;
  let onAbort: () => void = () => {};
  const stopped = new Promise<false>(resolve => {
    onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), RESEARCH_OWNER_FIELD_DEADLINE_MS);
  try {
    const verify = async (): Promise<boolean> => {
      try {
        const client = input.createClient(input.supabaseUrl, input.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: {
            headers: { Authorization: 'Bearer ' + token },
            fetch: (url, init) => {
              if (expired()) return Promise.reject(new Error('OWNER_FIELD_DEADLINE'));
              return fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
            },
          },
        });
        if (expired()) return false;
        const user = await client.auth.getUser(token);
        // A late Auth completion must never start the RPC, even if its SDK
        // transport ignored abort. Identity comes from Auth, not JWT metadata.
        if (expired() || user.error || user.data?.user?.id !== input.userId) return false;
        const owner = await client.rpc('is_research_owner_v1').abortSignal(signal);
        return !expired() && !owner.error && owner.data === true;
      } catch { return false; }
    };
    return await Promise.race([verify(), stopped]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/** Copy only the private receipt's ancestry; keep every other raw diagnostic.
 * JSON-string legacy reports remain strings. Never mutate stored Report input. */
export function withoutResearchOwnerReceipt<T extends Record<string, unknown>>(report: T): T {
  const original = report.ai_strategy_json;
  let ai: unknown = original;
  if (typeof original === 'string') {
    try { ai = JSON.parse(original); } catch { return report; }
  }
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return report;
  const document = ai as Record<string, unknown>;
  const evidence = document.recommendation_stock_evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || !Object.hasOwn(evidence, 'foundation_candidate')) return report;
  const copy: Record<string, unknown> = { ...evidence };
  delete copy.foundation_candidate;
  const projected = { ...document, recommendation_stock_evidence: copy };
  return { ...report, ai_strategy_json: typeof original === 'string' ? JSON.stringify(projected) : projected };
}
