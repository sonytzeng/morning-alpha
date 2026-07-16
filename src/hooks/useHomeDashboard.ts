import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  loadHomeDashboardData,
  type HomeDashboardData,
} from '@/services/homeDashboardService';
import {
  resolveMorningAlphaState,
  type MorningAlphaState,
} from '@/lib/morningAlpha/resolveMorningAlphaState';

export function useHomeDashboard() {
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isFetchingRef = useRef(false);

  /** V27 Stable Mode: MorningAlphaState is the PRIMARY data source — loaded FIRST */
  const [morningState, setMorningState] = useState<MorningAlphaState | null>(null);
  const [morningStateLoading, setMorningStateLoading] = useState(true);

  const loadMorningState = useCallback(async () => {
    try {
      setMorningStateLoading(true);
      const ms = await resolveMorningAlphaState();
      setMorningState(ms);
    } catch {
      // V28: Do NOT leave morningStateLoading=true — set error so page can show fallback
      setMorningState(null);
    } finally {
      setMorningStateLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setRefreshing(true);

    try {
      const result = await loadHomeDashboardData();
      setData(result);
      setError(result.error);
      setLastSyncAt(new Date().toISOString());
    } catch {
      setError('首頁資料暫時無法取得，請稍後重新載入。');
    } finally {
      setRefreshing(false);
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // V27: morningState is loaded FIRST as primary data source
    loadMorningState();

    // Secondary: load dashboard data in parallel
    refresh();

    // 30 秒 polling (dashboard data only, morningState only on explicit refresh)
    const interval = setInterval(refresh, 30000);

    // Supabase Realtime 訂閱
    const channel = supabase
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

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
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
