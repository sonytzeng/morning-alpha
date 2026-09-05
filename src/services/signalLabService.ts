import { supabase } from '@/lib/supabase';

export interface SignalLabSignal {
  prediction_id: string;
  symbol: string;
  signal_date: string;
  signal_score: number;
  signal_label: 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'STRONG_NEGATIVE';
  institutional_score: number;
  technical_score: number;
  volume_score: number;
  market_regime: string;
  confidence: number;
  data_completeness: number;
  reasons: string[];
  strategy_version: string;
  created_at: string;
}

export interface SignalLabExperiment {
  id: string;
  strategy_version: string;
  experiment_name: string;
  dataset_start: string | null;
  dataset_end: string | null;
  validity_status: 'pending' | 'valid' | 'insufficient' | 'blocked';
  edge_status: 'pending' | 'proven' | 'not_proven' | 'unproven';
  bias_flags: string[];
  metrics: Record<string, unknown>;
  baselines: Record<string, unknown>;
  completed_at: string | null;
}

export interface SignalLabQuality {
  id: string;
  run_date: string;
  run_timestamp: string;
  status: 'ready' | 'degraded' | 'blocked';
  eligible_universe: number;
  analyzed_count: number;
  complete_count: number;
  coverage_ratio: number;
  freshness_status: string;
  missing_count: number;
  duplicate_count: number;
  blocked_reason_codes: string[];
  compute_duration_ms: number | null;
}

export interface SignalLabPayload {
  version: string;
  disclaimer: string;
  signals: SignalLabSignal[];
  experiments: SignalLabExperiment[];
  quality: SignalLabQuality[];
  shadowRuns: Array<Record<string, unknown>>;
}

export async function fetchSignalLab(): Promise<SignalLabPayload> {
  const { data, error } = await supabase.functions.invoke('signal-lab-api', { method: 'GET' });
  if (error) {
    const status = Number((error as { context?: { status?: number } }).context?.status || 0);
    if (status === 401) throw new Error('SIGNAL_LAB_AUTH_REQUIRED');
    if (status === 403) throw new Error('SIGNAL_LAB_ADMIN_REQUIRED');
    throw new Error('SIGNAL_LAB_UNAVAILABLE');
  }
  if (!data?.success) throw new Error(String(data?.error || 'SIGNAL_LAB_UNAVAILABLE'));
  return {
    version: String(data.version || ''),
    disclaimer: String(data.disclaimer || ''),
    signals: Array.isArray(data.signals) ? data.signals : [],
    experiments: Array.isArray(data.experiments) ? data.experiments : [],
    quality: Array.isArray(data.quality) ? data.quality : [],
    shadowRuns: Array.isArray(data.shadowRuns) ? data.shadowRuns : [],
  };
}
