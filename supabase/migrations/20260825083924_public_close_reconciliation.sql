drop function if exists public.get_public_performance_journal(integer);

create or replace function public.get_public_performance_journal(p_limit integer default 90)
returns table (
  report_date date,
  market_bias text,
  confidence_score numeric,
  is_trading_day boolean,
  report_mode text,
  verification_status text,
  verification_data_status text,
  hit_or_miss text,
  prediction_result text,
  opening_bias text,
  actual_direction text,
  actual_taiex_close numeric,
  what_was_right text,
  what_was_wrong text,
  tomorrow_adjustment text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select greatest(1, least(coalesce(p_limit, 90), 90)) as safe_limit
), ranked_reports as (
  select
    r.*,
    row_number() over (
      partition by r.report_date
      order by
        case when lower(coalesce(r.ai_strategy_json #>> '{closing_verification_v2,status}', '')) = 'completed' then 1 else 0 end desc,
        case when lower(coalesce(r.ai_strategy_json #>> '{closing_verification_v2,data_status}', '')) = 'complete' then 1 else 0 end desc,
        r.updated_at desc nulls last,
        r.created_at desc nulls last
    ) as rn
  from public.reports r
  where r.report_date is not null
), latest_close_reviews as (
  select distinct on (cmr.report_date)
    cmr.*
  from public.close_market_reviews cmr
  order by cmr.report_date, cmr.updated_at desc, cmr.created_at desc
), reconciled as (
  select
    rr.report_date,
    rr.market_bias,
    rr.confidence_score,
    greatest(rr.updated_at, cmr.updated_at) as updated_at,
    rr.ai_strategy_json,
    coalesce(rr.ai_strategy_json -> 'closing_verification_v2', '{}'::jsonb)
      || case when cmr.id is null then '{}'::jsonb else jsonb_build_object(
        'status', case
          when cmr.taiex_change is not null
            and cardinality(cmr.missing_data) = 0
            and lower(cmr.data_quality) in ('高可信', 'verified', 'complete', 'high_confidence')
          then 'completed'
          when cmr.taiex_change is not null then 'direction_completed_data_degraded'
          else 'pending_real_market_data'
        end,
        'data_status', case
          when cmr.taiex_change is not null
            and cardinality(cmr.missing_data) = 0
            and lower(cmr.data_quality) in ('高可信', 'verified', 'complete', 'high_confidence')
          then 'complete'
          when cmr.taiex_change is not null then 'degraded'
          else 'pending'
        end,
        'hit_or_miss', case
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('hit', 'correct', 'confirmed', 'success', 'accurate', '方向一致', '大致一致', '命中') then 'hit'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('partial', 'mixed', 'partially_confirmed')
            or coalesce(cmr.verification_result, cmr.verification_label, '') like '%部分%' then 'partial'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('miss', 'wrong', 'failed', 'rejected', 'incorrect', 'inaccurate', '未命中') then 'miss'
          else 'pending'
        end,
        'prediction_result', case
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('hit', 'correct', 'confirmed', 'success', 'accurate', '方向一致', '大致一致', '命中') then 'hit'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('partial', 'mixed', 'partially_confirmed')
            or coalesce(cmr.verification_result, cmr.verification_label, '') like '%部分%' then 'partial'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('miss', 'wrong', 'failed', 'rejected', 'incorrect', 'inaccurate', '未命中') then 'miss'
          else 'pending'
        end,
        'actual_direction', cmr.actual_market_result,
        'actual_taiex_change', cmr.taiex_change,
        'actual_taiex_close', jsonb_build_object('change_percent', cmr.taiex_change),
        'verdict_label', cmr.verification_label,
        'verification_note', cmr.verification_note,
        'data_quality', cmr.data_quality,
        'missing_data', to_jsonb(cmr.missing_data),
        'verified_at', cmr.updated_at,
        'close_market_review_id', cmr.id,
        'source_priority', 'close_market_review',
        'no_fake_data', true
      ) end as cv
  from ranked_reports rr
  left join latest_close_reviews cmr on cmr.report_date = rr.report_date
  where rr.rn = 1
  order by rr.report_date desc
  limit (select safe_limit from params)
), normalized as (
  select
    r.*,
    coalesce(
      r.cv #>> '{actual_taiex_close,close}',
      r.cv #>> '{actual_taiex_close,price}',
      r.cv #>> '{actual_taiex_close,value}',
      r.cv #>> '{actual_taiex_close,change_percent}',
      r.cv ->> 'actual_taiex_change',
      case when jsonb_typeof(r.cv -> 'actual_taiex_close') = 'number' then r.cv ->> 'actual_taiex_close' end
    ) as actual_taiex_close_text
  from reconciled r
)
select
  n.report_date::date,
  n.market_bias::text,
  n.confidence_score::numeric,
  case lower(coalesce(n.ai_strategy_json ->> 'is_trading_day', ''))
    when 'true' then true
    when 'false' then false
    else null
  end as is_trading_day,
  nullif(n.ai_strategy_json ->> 'report_mode', '')::text as report_mode,
  nullif(n.cv ->> 'status', '')::text as verification_status,
  nullif(n.cv ->> 'data_status', '')::text as verification_data_status,
  nullif(n.cv ->> 'hit_or_miss', '')::text as hit_or_miss,
  nullif(n.cv ->> 'prediction_result', '')::text as prediction_result,
  nullif(n.cv ->> 'opening_bias', '')::text as opening_bias,
  nullif(n.cv ->> 'actual_direction', '')::text as actual_direction,
  case when n.actual_taiex_close_text ~ '^-?[0-9]+(\.[0-9]+)?$' then n.actual_taiex_close_text::numeric else null end as actual_taiex_close,
  case jsonb_typeof(n.cv -> 'what_was_right')
    when 'string' then nullif(n.cv ->> 'what_was_right', '')
    when 'object' then nullif(coalesce(n.cv #>> '{what_was_right,summary}', n.cv #>> '{what_was_right,note}', n.cv #>> '{what_was_right,action}', n.cv #>> '{what_was_right,text}'), '')
    when 'array' then nullif(n.cv #>> '{what_was_right,0}', '')
    else null
  end as what_was_right,
  case jsonb_typeof(n.cv -> 'what_was_wrong')
    when 'string' then nullif(n.cv ->> 'what_was_wrong', '')
    when 'object' then nullif(coalesce(n.cv #>> '{what_was_wrong,summary}', n.cv #>> '{what_was_wrong,note}', n.cv #>> '{what_was_wrong,action}', n.cv #>> '{what_was_wrong,text}'), '')
    when 'array' then nullif(n.cv #>> '{what_was_wrong,0}', '')
    else null
  end as what_was_wrong,
  case jsonb_typeof(n.cv -> 'tomorrow_adjustment')
    when 'string' then nullif(n.cv ->> 'tomorrow_adjustment', '')
    when 'object' then nullif(coalesce(
      n.cv #>> '{tomorrow_adjustment,summary}',
      n.cv #>> '{tomorrow_adjustment,note}',
      n.cv #>> '{tomorrow_adjustment,adjustment}',
      n.cv #>> '{tomorrow_adjustment,watch_tomorrow,0}',
      n.cv #>> '{tomorrow_adjustment,downgrade,0}',
      n.cv #>> '{tomorrow_adjustment,keep,0}'
    ), '')
    when 'array' then nullif(n.cv #>> '{tomorrow_adjustment,0}', '')
    else null
  end as tomorrow_adjustment,
  n.updated_at
from normalized n
order by n.report_date desc;
$$;

revoke all on function public.get_public_performance_journal(integer) from public;
grant execute on function public.get_public_performance_journal(integer) to anon;
grant execute on function public.get_public_performance_journal(integer) to authenticated;

comment on function public.get_public_performance_journal(integer) is
  'Public performance ledger reconciled from the canonical report and the authoritative unique close_market_review.';
;
