import { supabase } from '@/lib/supabase';

export interface SupabaseMarketNews {
  id: string;
  title: string;
  source: string;
  summary: string;
  importance_score: number;
  related_markets: string;
  related_sectors: string;
  taiwan_impact_summary: string;
  published_at: string;
  url: string;
  created_at: string;
  // V8.0 new fields
  final_score: number;
  is_selected: boolean;
  related_tw_names: string[];
  related_tw_symbols: string[];
  category: string;
  rejection_reason: string;
  normalized_title: string;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  aiImportance: number;
  affectedMarket: string;
  impactSummary: string;
  originalUrl: string;
  affectedSector?: string;
  // V8.0
  finalScore: number;
  isSelected: boolean;
  relatedTwNames: string[];
  category: string;
}

export function convertToNewsItem(item: SupabaseMarketNews): NewsItem {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    publishedAt: item.published_at,
    aiImportance: item.importance_score,
    affectedMarket: item.related_markets,
    impactSummary: item.taiwan_impact_summary || item.summary,
    originalUrl: item.url,
    affectedSector: item.related_sectors,
    finalScore: item.final_score,
    isSelected: item.is_selected,
    relatedTwNames: item.related_tw_names || [],
    category: item.category || 'Other',
  };
}

// === PUBLIC: Only selected news with high final_score ===
export async function fetchLatestMarketNews(limit = 5): Promise<NewsItem[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('*')
    .eq('is_selected', true)
    .order('final_score', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取新聞失敗: ${error.message}`);
  return (data || []).map(convertToNewsItem);
}

export async function fetchMarketNews(limit = 10): Promise<NewsItem[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('*')
    .eq('is_selected', true)
    .order('final_score', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取新聞失敗: ${error.message}`);
  return (data || []).map(convertToNewsItem);
}

// === ADMIN: All news including rejected ===
export async function fetchAdminMarketNews(limit = 50): Promise<NewsItem[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('*')
    .order('final_score', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取新聞失敗: ${error.message}`);
  return (data || []).map(convertToNewsItem);
}

// === News filter stats for verification page ===
export interface NewsFilterStats {
  totalToday: number;
  selectedToday: number;
  rejectedToday: number;
  avgFinalScore: number;
  maxFinalScore: number;
  maxScoreNews: NewsItem | null;
  topTwNames: string[];
}

export async function fetchNewsFilterStats(): Promise<NewsFilterStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { data, error } = await supabase
    .from('market_news')
    .select('*')
    .gte('created_at', todayIso)
    .order('final_score', { ascending: false });

  if (error) throw new Error(`讀取新聞統計失敗: ${error.message}`);

  const rows = (data || []) as SupabaseMarketNews[];
  const selected = rows.filter((r) => r.is_selected);
  const rejected = rows.filter((r) => !r.is_selected);

  const avgFinalScore = rows.length > 0
    ? Math.round(rows.reduce((sum, r) => sum + (r.final_score || 0), 0) / rows.length)
    : 0;

  const maxScore = rows.length > 0 ? Math.max(...rows.map((r) => r.final_score || 0)) : 0;
  const maxScoreNews = rows.find((r) => (r.final_score || 0) === maxScore) || null;

  // Collect top TW names from selected news
  const twNameSet = new Set<string>();
  selected.forEach((r) => {
    (r.related_tw_names || []).forEach((n) => twNameSet.add(n));
  });

  return {
    totalToday: rows.length,
    selectedToday: selected.length,
    rejectedToday: rejected.length,
    avgFinalScore,
    maxFinalScore: maxScore,
    maxScoreNews: maxScoreNews ? convertToNewsItem(maxScoreNews) : null,
    topTwNames: Array.from(twNameSet).slice(0, 10),
  };
}