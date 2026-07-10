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
    r.report_date,
    r.market_bias,
    r.confidence_score,
    r.created_at,
    r.updated_at,
    r.ai_strategy_json,
    row_number() over (
      partition by r.report_date
      order by
        case when lower(coalesce(r.ai_strategy_json #>> '{closing_verification_v2,status}', '')) = 'completed' then 1 else 0 end desc,
        case when lower(coalesce(r.ai_strategy_json #>> '{closing_verification_v2,data_status}', '')) = 'complete' then 1 else 0 end desc,
        case when lower(coalesce(r.ai_strategy_json ->> 'is_trading_day', '')) = 'true' then 1 else 0 end desc,
        r.updated_at desc nulls last,
        r.created_at desc nulls last
    ) as rn
  from public.reports r
  where r.report_date is not null
), picked_reports as (
  select
    rr.report_date,
    rr.market_bias,
    rr.confidence_score,
    rr.updated_at,
    rr.ai_strategy_json,
    rr.ai_strategy_json -> 'closing_verification_v2' as cv
  from ranked_reports rr
  where rr.rn = 1
  order by rr.report_date desc
  limit (select safe_limit from params)
), public_rows as (
  select
    p.report_date,
    p.market_bias,
    p.confidence_score,
    p.updated_at,
    p.ai_strategy_json,
    p.cv,
    coalesce(
      p.cv #>> '{actual_taiex_close,close}',
      p.cv #>> '{actual_taiex_close,price}',
      p.cv #>> '{actual_taiex_close,value}',
      case when jsonb_typeof(p.cv -> 'actual_taiex_close') = 'number' then p.cv ->> 'actual_taiex_close' end
    ) as actual_taiex_close_text
  from picked_reports p
)
select
  pr.report_date::date,
  pr.market_bias::text,
  pr.confidence_score::numeric,
  case lower(coalesce(pr.ai_strategy_json ->> 'is_trading_day', ''))
    when 'true' then true
    when 'false' then false
    else null
  end as is_trading_day,
  nullif(pr.ai_strategy_json ->> 'report_mode', '')::text as report_mode,
  nullif(pr.cv ->> 'status', '')::text as verification_status,
  nullif(pr.cv ->> 'data_status', '')::text as verification_data_status,
  nullif(pr.cv ->> 'hit_or_miss', '')::text as hit_or_miss,
  nullif(pr.cv ->> 'prediction_result', '')::text as prediction_result,
  nullif(pr.cv ->> 'opening_bias', '')::text as opening_bias,
  nullif(pr.cv ->> 'actual_direction', '')::text as actual_direction,
  case
    when pr.actual_taiex_close_text ~ '^-?[0-9]+(\.[0-9]+)?$' then pr.actual_taiex_close_text::numeric
    else null
  end as actual_taiex_close,
  case jsonb_typeof(pr.cv -> 'what_was_right')
    when 'string' then nullif(pr.cv ->> 'what_was_right', '')
    when 'object' then nullif(coalesce(
      pr.cv #>> '{what_was_right,summary}',
      pr.cv #>> '{what_was_right,note}',
      pr.cv #>> '{what_was_right,action}',
      pr.cv #>> '{what_was_right,title}',
      pr.cv #>> '{what_was_right,content}',
      pr.cv #>> '{what_was_right,text}'
    ), '')
    when 'array' then (
      select nullif(coalesce(
        case when jsonb_typeof(item.value) = 'string' then item.value #>> '{}' end,
        item.value ->> 'summary',
        item.value ->> 'note',
        item.value ->> 'action',
        item.value ->> 'title',
        item.value ->> 'content',
        item.value ->> 'text'
      ), '')
      from jsonb_array_elements(pr.cv -> 'what_was_right') as item(value)
      limit 1
    )
    else null
  end as what_was_right,
  case jsonb_typeof(pr.cv -> 'what_was_wrong')
    when 'string' then nullif(pr.cv ->> 'what_was_wrong', '')
    when 'object' then nullif(coalesce(
      pr.cv #>> '{what_was_wrong,summary}',
      pr.cv #>> '{what_was_wrong,note}',
      pr.cv #>> '{what_was_wrong,action}',
      pr.cv #>> '{what_was_wrong,title}',
      pr.cv #>> '{what_was_wrong,content}',
      pr.cv #>> '{what_was_wrong,text}'
    ), '')
    when 'array' then (
      select nullif(coalesce(
        case when jsonb_typeof(item.value) = 'string' then item.value #>> '{}' end,
        item.value ->> 'summary',
        item.value ->> 'note',
        item.value ->> 'action',
        item.value ->> 'title',
        item.value ->> 'content',
        item.value ->> 'text'
      ), '')
      from jsonb_array_elements(pr.cv -> 'what_was_wrong') as item(value)
      limit 1
    )
    else null
  end as what_was_wrong,
  case jsonb_typeof(pr.cv -> 'tomorrow_adjustment')
    when 'string' then nullif(pr.cv ->> 'tomorrow_adjustment', '')
    when 'object' then nullif(coalesce(
      pr.cv #>> '{tomorrow_adjustment,summary}',
      pr.cv #>> '{tomorrow_adjustment,note}',
      pr.cv #>> '{tomorrow_adjustment,action}',
      pr.cv #>> '{tomorrow_adjustment,adjustment}',
      pr.cv #>> '{tomorrow_adjustment,title}',
      pr.cv #>> '{tomorrow_adjustment,content}',
      pr.cv #>> '{tomorrow_adjustment,text}'
    ), '')
    when 'array' then (
      select nullif(coalesce(
        case when jsonb_typeof(item.value) = 'string' then item.value #>> '{}' end,
        item.value ->> 'summary',
        item.value ->> 'note',
        item.value ->> 'action',
        item.value ->> 'adjustment',
        item.value ->> 'title',
        item.value ->> 'content',
        item.value ->> 'text'
      ), '')
      from jsonb_array_elements(pr.cv -> 'tomorrow_adjustment') as item(value)
      limit 1
    )
    else null
  end as tomorrow_adjustment,
  pr.updated_at
from public_rows pr
order by pr.report_date desc;
$$;

revoke all on function public.get_public_performance_journal(integer) from public;
grant execute on function public.get_public_performance_journal(integer) to anon;
grant execute on function public.get_public_performance_journal(integer) to authenticated;
