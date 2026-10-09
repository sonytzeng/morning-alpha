import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseMemberCatalog, type AcademyMemberCatalog } from '@/features/academy/member';

export type AcademyAccess = { kind: 'loading' | 'denied' | 'unavailable' } | {
  kind: 'member'; id: string; generation: number; signal: AbortSignal; catalog: AcademyMemberCatalog;
};

export function useAcademyAccess() {
  const [access, setAccess] = useState<AcademyAccess>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let live = true, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (g: number, signal: AbortSignal) => {
      const current = () => live && !signal.aborted && g === generation.current;
      const deadline = setTimeout(() => {
        if (current()) { controller.abort(); setAccess({ kind: 'unavailable' }); }
      }, 20000);
      try {
        const user = await supabase.auth.getUser();
        if (!current()) return;
        if (user.error || !user.data.user?.id) { setAccess({ kind: user.error && user.error.name !== 'AuthSessionMissingError' ? 'unavailable' : 'denied' }); return; }
        const result = await supabase.rpc('get_academy_catalog_v11').abortSignal(signal);
        if (!current()) return;
        if (result.error) { setAccess({ kind: result.error.code === '42501' ? 'denied' : 'unavailable' }); return; }
        const catalog = parseMemberCatalog(result.data, user.data.user.id);
        setAccess({ kind: 'member', id: user.data.user.id, catalog, generation: g, signal });
      } catch { if (current()) setAccess({ kind: 'unavailable' }); }
      finally { clearTimeout(deadline); }
    };
    const invalidate = (signedOut = false) => {
      controller.abort(); controller = new AbortController();
      const g = ++generation.current, signal = controller.signal;
      clearTimeout(timer); setAccess({ kind: signedOut ? 'denied' : 'loading' });
      // Never await Supabase work inside its synchronous auth callback.
      if (!signedOut) timer = setTimeout(() => { if (live && g === generation.current) void check(g, signal); }, 0);
    };
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY'].includes(event)) invalidate(event === 'SIGNED_OUT');
    });
    invalidate();
    return () => { live = false; controller.abort(); clearTimeout(timer); data.subscription.unsubscribe(); };
  }, [attempt]);
  return { access, retry: () => setAttempt(value => value + 1) };
}
