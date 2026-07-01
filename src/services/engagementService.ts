/**
 * engagementService — User retention & early access conversion tracking
 *
 * 提供匿名事件追蹤與早鳥名單寫入。
 * 所有寫入操作都不影響前台使用：失敗只 console.warn。
 */

import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export type EngagementEventName =
  | 'view_home'
  | 'view_report_today'
  | 'click_free_summary'
  | 'click_member_preview'
  | 'click_early_access'
  | 'submit_early_access'
  | 'click_reels_preview'
  | 'click_line_interest'
  | 'view_close_review';

export interface EarlyAccessInput {
  email?: string;
  line_name?: string;
  user_type?: string;
  interests?: string[];
  source_page?: string;
}

export interface EngagementMetrics {
  total_home_views: number;
  total_report_views: number;
  total_free_summary_clicks: number;
  total_member_preview_clicks: number;
  total_early_access_clicks: number;
  total_early_access_submits: number;
  total_reels_clicks: number;
  total_line_clicks: number;
  total_close_review_views: number;
  early_access_signups: number;
  conversion_preview_to_early: number;
  conversion_early_to_submit: number;
  conversion_report_to_preview: number;
}

export interface EarlyAccessSignup {
  id: string;
  email: string | null;
  line_name: string | null;
  user_type: string | null;
  interests: string[] | null;
  source_page: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════
// Track engagement event (fire & forget)
// ═══════════════════════════════════════════════════

export async function trackEngagementEvent(
  eventName: EngagementEventName,
  options?: {
    page_path?: string;
    report_date?: string;
    content_type?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from('content_engagement_events').insert({
      event_name: eventName,
      page_path: options?.page_path || (typeof window !== 'undefined' ? window.location.pathname : null),
      report_date: options?.report_date || null,
      content_type: options?.content_type || null,
      metadata: options?.metadata || null,
    });

    if (error) {
      console.warn('[engagementService] Failed to track event:', eventName, error.message);
    }
  } catch (err) {
    console.warn('[engagementService] trackEngagementEvent error:', err);
  }
}

// ═══════════════════════════════════════════════════
// Submit early access signup
// ═══════════════════════════════════════════════════

export async function submitEarlyAccess(input: EarlyAccessInput): Promise<{ success: boolean; error?: string; id?: string }> {
  if (!input.email?.trim() && !input.line_name?.trim()) {
    return { success: false, error: '請填寫 Email 或 LINE 暱稱。' };
  }

  // Email is now required
  if (!input.email?.trim()) {
    return { success: false, error: '請填寫 Email。' };
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(input.email.trim())) {
    return { success: false, error: '請填寫正確的 Email 格式。' };
  }

  try {
    const { data, error } = await supabase
      .from('early_access_signups')
      .insert({
        email: input.email?.trim() || null,
        line_name: input.line_name?.trim() || null,
        user_type: input.user_type || null,
        interests: input.interests || [],
        source_page: input.source_page || (typeof window !== 'undefined' ? window.location.pathname : null),
      })
      .select('id')
      .single();

    if (error) {
      // Detect table-not-found error (relation does not exist)
      const msg = error.message || '';
      const isTableMissing =
        msg.includes('does not exist') ||
        msg.includes('relation') ||
        (error.code && String(error.code).startsWith('42'));
      if (isTableMissing) {
        return { success: false, error: '早鳥名單暫時無法送出，請稍後再試。' };
      }
      console.warn('[engagementService] Failed to submit early access:', error.message);
      return { success: false, error: '送出失敗，請稍後再試。' };
    }

    return { success: true, id: data?.id as string };
  } catch (err) {
    console.warn('[engagementService] submitEarlyAccess error:', err);
    return { success: false, error: '送出失敗，請稍後再試。' };
  }
}

// ═══════════════════════════════════════════════════
// Update early access signup with supplemental preferences (post-submit optional)
// ═══════════════════════════════════════════════════

export async function updateEarlyAccessSupplement(
  signupId: string,
  supplementPrefs: string[]
): Promise<{ success: boolean; error?: string }> {
  if (!signupId || supplementPrefs.length === 0) {
    return { success: true };
  }

  try {
    // Merge supplement prefs into existing interests or store as metadata
    const { error } = await supabase
      .from('early_access_signups')
      .update({
        interests: supplementPrefs,
      })
      .eq('id', signupId);

    if (error) {
      console.warn('[engagementService] Failed to update supplement prefs:', error.message);
      return { success: false, error: '偏好儲存失敗，但不影響早鳥登記。' };
    }

    return { success: true };
  } catch (err) {
    console.warn('[engagementService] updateEarlyAccessSupplement error:', err);
    return { success: false, error: '偏好儲存失敗，但不影響早鳥登記。' };
  }
}

// ═══════════════════════════════════════════════════
// Fetch engagement metrics (admin only, last 7 days)
// ═══════════════════════════════════════════════════

export async function fetchEngagementMetrics(): Promise<EngagementMetrics | null> {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString();

    // Fetch all events in last 7 days
    const { data: events, error: eventErr } = await supabase
      .from('content_engagement_events')
      .select('event_name')
      .gte('created_at', sevenDaysAgoStr);

    if (eventErr) {
      console.warn('[engagementService] Failed to fetch events:', eventErr.message);
      return null;
    }

    // Fetch early access signups in last 7 days
    const { count: signupCount, error: signupErr } = await supabase
      .from('early_access_signups')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgoStr);

    if (signupErr) {
      console.warn('[engagementService] Failed to fetch signups:', signupErr.message);
    }

    const totals: Record<string, number> = {};
    for (const ev of events || []) {
      totals[ev.event_name] = (totals[ev.event_name] || 0) + 1;
    }

    const homeViews = totals.view_home || 0;
    const reportViews = totals.view_report_today || 0;
    const freeSummaryClicks = totals.click_free_summary || 0;
    const memberPreviewClicks = totals.click_member_preview || 0;
    const earlyAccessClicks = totals.click_early_access || 0;
    const earlyAccessSubmits = totals.submit_early_access || 0;
    const reelsClicks = totals.click_reels_preview || 0;
    const lineClicks = totals.click_line_interest || 0;
    const closeReviewViews = totals.view_close_review || 0;

    const totalEvents = (events || []).length;

    return {
      total_home_views: homeViews,
      total_report_views: reportViews,
      total_free_summary_clicks: freeSummaryClicks,
      total_member_preview_clicks: memberPreviewClicks,
      total_early_access_clicks: earlyAccessClicks,
      total_early_access_submits: earlyAccessSubmits,
      total_reels_clicks: reelsClicks,
      total_line_clicks: lineClicks,
      total_close_review_views: closeReviewViews,
      early_access_signups: signupCount || 0,
      conversion_report_to_preview: reportViews > 0 ? Math.round((memberPreviewClicks / reportViews) * 100) : 0,
      conversion_preview_to_early: memberPreviewClicks > 0 ? Math.round((earlyAccessClicks / memberPreviewClicks) * 100) : 0,
      conversion_early_to_submit: earlyAccessClicks > 0 ? Math.round((earlyAccessSubmits / earlyAccessClicks) * 100) : 0,
    };
  } catch (err) {
    console.warn('[engagementService] fetchEngagementMetrics error:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// Fetch early access signups list (admin only)
// ═══════════════════════════════════════════════════

export async function fetchEarlyAccessSignups(page = 1, pageSize = 20): Promise<{ signups: EarlyAccessSignup[]; total: number }> {
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, count, error } = await supabase
      .from('early_access_signups')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.warn('[engagementService] Failed to fetch early access list:', error.message);
      return { signups: [], total: 0 };
    }

    return {
      signups: (data || []).map((item: Record<string, unknown>) => ({
        id: String(item.id || ''),
        email: typeof item.email === 'string' ? item.email : null,
        line_name: typeof item.line_name === 'string' ? item.line_name : null,
        user_type: typeof item.user_type === 'string' ? item.user_type : null,
        interests: Array.isArray(item.interests) ? item.interests as string[] : null,
        source_page: typeof item.source_page === 'string' ? item.source_page : null,
        created_at: typeof item.created_at === 'string' ? item.created_at : '',
      })),
      total: count || 0,
    };
  } catch (err) {
    console.warn('[engagementService] fetchEarlyAccessSignups error:', err);
    return { signups: [], total: 0 };
  }
}

// ═══════════════════════════════════════════════════
// Content product signal (admin diagnostic)
// ═══════════════════════════════════════════════════

export function getContentProductSignal(metrics: EngagementMetrics | null): {
  signal: string;
  icon: string;
  colorClass: string;
} {
  if (!metrics || metrics.total_home_views === 0) {
    return {
      signal: '尚未累積足夠真實使用資料，請先小範圍公開測試。',
      icon: 'ri-time-line',
      colorClass: 'text-foreground-400',
    };
  }

  if (metrics.total_report_views === 0 || metrics.total_report_views < 3) {
    return {
      signal: '目前導流不足，先優化首頁 CTA 或 Reels 導流。',
      icon: 'ri-guide-line',
      colorClass: 'text-amber-600',
    };
  }

  if (metrics.total_member_preview_clicks === 0 || metrics.total_member_preview_clicks < 3) {
    return {
      signal: '會員預覽吸引力不足，需要強化免費摘要下方的付費價值說明。',
      icon: 'ri-eye-off-line',
      colorClass: 'text-amber-600',
    };
  }

  if (metrics.total_early_access_clicks > 0 && metrics.total_early_access_submits === 0) {
    return {
      signal: '使用者有興趣但尚未願意留下資料，早鳥文案或信任感需要加強。',
      icon: 'ri-emotion-sad-line',
      colorClass: 'text-amber-600',
    };
  }

  if (metrics.total_early_access_submits > 0) {
    return {
      signal: '早鳥意願正在累積，可繼續觀察是否具備未來收費基礎。',
      icon: 'ri-seedling-line',
      colorClass: 'text-emerald-600',
    };
  }

  return {
    signal: '持續觀察使用者互動模式中。',
    icon: 'ri-pulse-line',
    colorClass: 'text-foreground-500',
  };
}