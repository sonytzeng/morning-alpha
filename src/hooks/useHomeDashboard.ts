import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { invalidateReportRequestCache } from '@/services/entitlementService';
import {
  loadHomeDashboardData,
  type HomeDashboardData,
} from '@/services/homeDashboardService';
import {
  resolveMorningAlphaState,
  type MorningAlphaState,
} from '@/lib/morningAlpha/resolveMorningAlphaState';

// Realtime is the primary update path. A five-minute reconciliation poll keeps
// the dashboard self-healing without multiplying Edge Function traffic at scale.
const ACTIVE_MARKET_POLL_MS = 300_000;
const OFF_HOURS_POLL_MS = 900_000;

export function getAdaptiveDashboardPollMs(now = new Date(), hidden = false): number {
  if (hidden) return OFF_HOURS_POLL_MS;
  const taipeiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const read = (type: string) => Number(taipeiParts.find((part) => part.type === type)?.value || 0);
  const taipeiMinutes = read('hour') * 60 + read('minute');
  return taipeiMinutes >= 5 * 60 + 30 && taipeiMinutes <= 14 * 60 + 30
    ? ACTIVE_MARKET_POLL_MS
    : OFF_HOURS_POLL_MS;
}

export function useHomeDashboard() {
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isFetchingRef = useRef<number | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const morningRequest = useRef(0);

  /** V27 Stable Mode: MorningAlphaState is the PRIMARY data source — loaded FIRST */
  const [morningState, setMorningState] = useState<MorningAlphaState | null>(null);
  const [morningStateLoading, setMorningStateLoading] = useState(true);

  const loadMorningState = useCallback(async () => {
    if (!active.current) return;
    const epoch = generation.current, request = ++morningRequest.current;
    const current = () => active.current && epoch === generation.current && request === morningRequest.current;
    try {
      setMorningStateLoading(true);
      const ms = await resolveMorningAlphaState();
      if (current()) setMorningState(ms);
    } catch {
      // V28: Do NOT leave morningStateLoading=true — set error so page can show fallback
      if (current()) setMorningState(null);
    } finally {
      if (current()) setMorningStateLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!active.current || isFetchingRef.current === generation.current) return;
    const epoch = generation.current;
    const current = () => active.current && epoch === generation.current;
    isFetchingRef.current = epoch;
    setRefreshing(true);

    try {
      const result = await loadHomeDashboardData();
      if (!current()) return;
      setData(result);
      setError(result.error);
      setLastSyncAt(new Date().toISOString());
    } catch {
      if (current()) setError('首頁資料暫時無法取得，請稍後重新載入。');
    } finally {
      if (current()) {
        setRefreshing(false);
        setLoading(false);
        isFetchingRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    active.current = true;
    generation.current++;
    isFetchingRef.current = null;
    // V27: morningState is loaded FIRST as primary data source
    loadMorningState();

    // Secondary: load dashboard data in parallel
    refresh();

    // Realtime is primary; adaptive polling is a low-traffic recovery path.
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const schedulePoll = () => {
      if (disposed) return;
      pollTimer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await refresh();
        if (!disposed) schedulePoll();
      }, getAdaptiveDashboardPollMs(new Date(), document.visibilityState !== 'visible'));
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    schedulePoll();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    // Resolve the SDK session before the first join. Realtime 2.15.5 can queue
    // a tokenless join while its lazy access-token callback is still pending.
    // Keep anonymous clients on the public socket contract: a publishable API
    // key is not a session JWT and must not be passed to setAuth explicitly.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let channelRemoval: Promise<unknown> = Promise.resolve();
    const subscribe = async () => {
      const epoch = generation.current;
      const current = () => !disposed && epoch === generation.current;
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (!current()) return;
      if (auth.session) await supabase.realtime.setAuth(auth.session.access_token);
      if (!current()) return;
      channel = supabase
        .channel('morning-alpha-home-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'market_data' },
          () => { refresh(); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reports' },
          () => {
            refresh();
            loadMorningState(); // Also refresh morningState when reports change
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'intraday_checks' },
          () => { refresh(); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'opening_market_radar' },
          () => { refresh(); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'market_source_health' },
          () => { refresh(); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'market_news' },
          () => { refresh(); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'close_market_reviews' },
          () => { refresh(); }
        )
        .subscribe();
    };
    void subscribe().catch(() => {
      // Do not fall back to an anonymous join after an Auth error. The existing
      // bounded reconciliation poll remains active; never log credentials.
      if (!disposed) console.warn('Home realtime subscription unavailable; periodic refresh remains active.');
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (disposed || !['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY'].includes(event)) return;
      generation.current++;
      morningRequest.current++;
      isFetchingRef.current = null;
      invalidateReportRequestCache();
      setData(null); setMorningState(null); setError(null); setLastSyncAt(null);
      setLoading(true); setMorningStateLoading(true); setRefreshing(false);
      if (channel) {
        channelRemoval = supabase.removeChannel(channel);
        channel = null;
      }
      const removed = channelRemoval;
      const epoch = generation.current;
      // Auth callbacks hold the SDK session lock: defer all subsequent reads.
      queueMicrotask(() => {
        if (disposed || epoch !== generation.current) return;
        void loadMorningState(); void refresh();
        void removed.then(() => {
          if (!disposed && epoch === generation.current) return subscribe();
        }).catch(() => {
          if (!disposed && epoch === generation.current) console.warn('Home realtime subscription unavailable; periodic refresh remains active.');
        });
      });
    });

    return () => {
      disposed = true;
      active.current = false;
      // Inactive work is rejected; a StrictMode remount advances generation
      // before issuing reads, so a previous mount cannot become current again.
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      if (channel) void supabase.removeChannel(channel);
      authListener.subscription.unsubscribe();
    };
  }, [refresh, loadMorningState]);

  return {
    data,
    loading: loading || morningStateLoading,
    error,
    lastSyncAt,
    refreshing,
    refresh: () => { refresh(); loadMorningState(); },
    morningState,
  };
}
