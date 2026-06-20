import { supabase } from '@/lib/supabase';
import { isProxyData, isWithin36Hours } from '@/utils/tradingDay';

export interface SupabaseMarketData {
  id: string;
  symbol: string;
  name: string;
  market: string;
  value: string | number;
  change_percent: number;
  change?: number;
  status: string;
  taiwan_impact: string;
  captured_at: string;
  updated_at?: string;
  source?: string;
}

export interface MarketIndex {
  name: string;
  symbol: string;
  value: string;
  change: string;
  changePercent: string;
  status: 'up' | 'down' | 'flat';
  impactOnTaiwan: string;
  isProxy?: boolean;
  isExpired?: boolean;
}

// ===== Symbol role classification =====
export const SYMBOL_ROLES = {
  taiex: 'TAIEX',
  tsmc_tw: '2330',
  tsmc_adr: 'TSM',
  txf: 'TXF',
} as const;

export function isTxfProxy(item: SupabaseMarketData): boolean {
  const nameLower = (item.name || '').toLowerCase();
  return nameLower.includes('proxy') || nameLower.includes('代估') || nameLower.includes('代理');
}

export function isTxfExpired(item: SupabaseMarketData): boolean {
  const dateToCheck = item.captured_at || item.updated_at;
  return !isWithin36Hours(dateToCheck);
}

export function isGeneralProxy(item: SupabaseMarketData): boolean {
  return isProxyData(item.name, (item as Record<string, unknown>).source as string | undefined);
}

export function convertToMarketIndex(item: SupabaseMarketData): MarketIndex {
  const changePercent = Number(item.change_percent);
  const isUp = changePercent > 0;
  const isDown = changePercent < 0;
  const status: 'up' | 'down' | 'flat' = isUp ? 'up' : isDown ? 'down' : 'flat';

  const rawValue = typeof item.value === 'number' ? item.value : Number(item.value);

  let valueStr: string;
  if (item.symbol === '2330' || item.symbol === 'TAIEX' || item.symbol === 'TXF') {
    valueStr = item.symbol === '2330'
      ? rawValue.toLocaleString('zh-TW', { maximumFractionDigits: 0 })
      : rawValue.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    valueStr = rawValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const isProxy = isGeneralProxy(item);
  const isExpired = !isWithin36Hours(item.captured_at || item.updated_at);

  return {
    name: item.name,
    symbol: item.symbol,
    value: valueStr,
    change: isUp ? `+${changePercent.toFixed(2)}` : changePercent.toFixed(2),
    changePercent: isUp ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`,
    status,
    impactOnTaiwan: item.taiwan_impact,
    isProxy,
    isExpired,
  };
}

export async function fetchMarketData(): Promise<SupabaseMarketData[]> {
  const { data, error } = await supabase
    .from('market_data')
    .select('*')
    .order('captured_at', { ascending: false });

  if (error) throw new Error(`讀取市場數據失敗: ${error.message}`);
  return data || [];
}

export async function fetchMarketDataBySymbols(symbols: string[]): Promise<SupabaseMarketData[]> {
  const { data, error } = await supabase
    .from('market_data')
    .select('*')
    .in('symbol', symbols)
    .order('captured_at', { ascending: false });

  if (error) throw new Error(`讀取市場數據失敗: ${error.message}`);

  const seen = new Set<string>();
  const deduped: SupabaseMarketData[] = [];
  for (const item of (data || [])) {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      deduped.push(item as SupabaseMarketData);
    }
  }
  return deduped;
}

export async function fetchMarketDataAsIndices(): Promise<MarketIndex[]> {
  const items = await fetchMarketData();
  const seen = new Set<string>();
  const deduped: SupabaseMarketData[] = [];
  for (const item of items) {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      deduped.push(item);
    }
  }
  return deduped.map(convertToMarketIndex);
}

export async function fetchTXFData(): Promise<SupabaseMarketData | null> {
  const { data, error } = await supabase
    .from('market_data')
    .select('*')
    .eq('symbol', 'TXF')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data as SupabaseMarketData | null;
}

/**
 * Check if TXF data is fresh (within 36 hours) and not proxy.
 * Returns the display status for TXF across all pages.
 */
export function getTXFDisplayStatus(marketData: SupabaseMarketData[] | null | undefined): {
  hasFreshTXF: boolean;
  isProxy: boolean;
  isExpired: boolean;
  label: string;
  trustImpact: 'none' | 'moderate' | 'significant';
} {
  if (!marketData || marketData.length === 0) {
    return { hasFreshTXF: false, isProxy: false, isExpired: true, label: 'TXF 暫缺', trustImpact: 'significant' };
  }

  const txf = marketData.find((d) => d.symbol === 'TXF');
  if (!txf) {
    return { hasFreshTXF: false, isProxy: false, isExpired: true, label: 'TXF 暫缺', trustImpact: 'significant' };
  }

  if (isGeneralProxy(txf)) {
    return { hasFreshTXF: false, isProxy: true, isExpired: true, label: 'TXF 暫缺（代理指標）', trustImpact: 'significant' };
  }

  if (isTxfExpired(txf)) {
    const hours = (() => {
      const dateToCheck = txf.captured_at || txf.updated_at;
      if (!dateToCheck) return null;
      const d = new Date(dateToCheck);
      const diffMs = Date.now() - d.getTime();
      return Math.round(diffMs / (1000 * 60 * 60));
    })();
    return {
      hasFreshTXF: false,
      isProxy: false,
      isExpired: true,
      label: hours !== null ? `TXF 暫缺（${hours}h 未更新）` : 'TXF 暫缺',
      trustImpact: 'moderate',
    };
  }

  return { hasFreshTXF: true, isProxy: false, isExpired: false, label: 'TXF 有效', trustImpact: 'none' };
}