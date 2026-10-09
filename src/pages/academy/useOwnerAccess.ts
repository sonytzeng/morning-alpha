import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Access = { kind: 'loading' | 'denied' | 'unavailable' } |
  { kind: 'owner'; id: string; generation: number; signal: AbortSignal };

export function useOwnerAccess(): Access {
  const [access, setAccess] = useState<Access>({ kind: 'loading' });
  useEffect(() => {
    let live = true, generation = 0;
    let controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (g: number, signal: AbortSignal) => {
      try {
        const [owner, user] = await Promise.all([supabase.rpc('is_research_owner_v1'), supabase.auth.getUser()]);
        if (!live || signal.aborted || g !== generation) return;
        if (owner.error && owner.error.code !== '42501') { setAccess({ kind: 'unavailable' }); return; }
        if (owner.error || owner.data !== true || user.error || !user.data.user?.id) { setAccess({ kind: 'denied' }); return; }
        setAccess({ kind: 'owner', id: user.data.user.id, generation: g, signal });
      } catch { if (live && !signal.aborted && g === generation) setAccess({ kind: 'unavailable' }); }
    };
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (!['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) return;
      controller.abort(); controller = new AbortController(); generation += 1;
      clearTimeout(timer);
      setAccess({ kind: event === 'SIGNED_OUT' ? 'denied' : 'loading' });
      if (event !== 'SIGNED_OUT') {
        const g = generation, signal = controller.signal;
        // Supabase work must run outside the synchronous auth callback.
        timer = setTimeout(() => { if (live && g === generation) void check(g, signal); }, 0);
      }
    });
    void check(generation, controller.signal);
    return () => { live = false; generation += 1; controller.abort(); clearTimeout(timer); data.subscription.unsubscribe(); };
  }, []);
  return access;
}
