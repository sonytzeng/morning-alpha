-- Optional read-only catalog/aggregate audit. Never exported member identities or raw payloads.
-- Not a migration, not a scheduled collector. Production counts change naturally over time.
begin read only;
select count(*) as predictions, min(report_date) as first_date, max(report_date) as last_date,
  count(distinct report_date) filter (where prediction_at <
    ((report_date::timestamp + interval '9 hours') at time zone 'Asia/Taipei')) as preopen_dates
from public.learning_predictions;
select status,data_quality_status,count(*) from public.prediction_outcomes
group by status,data_quality_status order by status,data_quality_status;
select 'learning_rules' as asset,count(*) from public.learning_rules
union all select 'rule_backtests',count(*) from public.rule_backtests;
select c.relname,c.relrowsecurity,c.relforcerowsecurity,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('learning_predictions','prediction_outcomes',
  'learning_rules','rule_backtests','learning_cases','model_evaluations');
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in ('decision_snapshots','learning_predictions','prediction_outcomes','profiles')
order by table_name,ordinal_position;
rollback;
