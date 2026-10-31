-- Separate candidate: ONE new watchdog job, no existing job edits.
-- Tick is cheap outside 06:50–09:00 Taipei; within it resumes one daily queue.
-- Apply only after the independent worker and intake schema are reviewed.
begin;
do $$begin
 if exists(select from cron.job where jobname='ma-ai-asof-watchdog-v1') then raise exception 'AI_INTAKE_CRON_ALREADY_EXISTS';end if;
 perform cron.schedule('ma-ai-asof-watchdog-v1','*/5 * * * *','select public.tick_daily_stock_ai_intake_v1();');
end $$;
commit;
