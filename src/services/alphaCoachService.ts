import { supabase } from '@/lib/supabase';

export const ALPHA_COACH_SAFE_REFUSAL = '目前 Morning Alpha 的正式資料不足以支持這個結論，我不會自行推測。';

export type AlphaCoachAnswer = {
  plain_explanation: string;
  relation_to_today: string;
  supporting_evidence: string[];
  confirmation_conditions: string[];
  invalidation_conditions: string[];
  data_source_and_time: string;
};

export type AlphaCoachSource = {
  id: string;
  label: string;
  url?: string;
  data_as_of?: string;
  supports?: Array<
    | 'plain_explanation'
    | 'relation_to_today'
    | 'supporting_evidence'
    | 'confirmation_conditions'
    | 'invalidation_conditions'
    | 'data_source_and_time'
  >;
};

export type AlphaCoachResponse = {
  success: boolean;
  refused?: boolean;
  answer: AlphaCoachAnswer | string;
  sources?: AlphaCoachSource[];
  report_date?: string;
  data_as_of?: string;
};

async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('ALPHA_COACH_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export async function askAlphaCoach(question: string): Promise<AlphaCoachResponse> {
  try {
    const request = supabase.functions.invoke<AlphaCoachResponse>('alpha-coach', {
      body: { question },
    });
    const { data, error } = await withTimeout(request, 12_000);
    if (error || !data) throw new Error('ALPHA_COACH_UNAVAILABLE');
    return data;
  } catch {
    return { success: false, refused: true, answer: ALPHA_COACH_SAFE_REFUSAL };
  }
}
