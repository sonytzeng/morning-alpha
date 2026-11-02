-- Source-only intake RPC capacity; no body, ACL, role, deadline or quality changes.
-- The service role inherited authenticator's 8s timeout. Real SOURCE request
-- 1216 was cancelled by PostgreSQL with SQLSTATE 57014 (statement timeout).
-- HTTP SOURCE remains 16s, handler 45s, dispatch 60s; other RPCs remain 8s.
begin;
do $guard$
declare f regprocedure:='public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure;
 cfg text[];body_sha text;
begin
 select proconfig,encode(sha256(convert_to(prosrc,'UTF8')),'hex') into cfg,body_sha from pg_proc where oid=f;
 if body_sha is distinct from '1d7ea5f8bb7f247c799f9e1fb98be86f616703de1258e1d5d3eeaffddb59da90'
  or cfg is distinct from array['search_path=""','work_mem=16MB']
  or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
  or not has_function_privilege('service_role',f,'EXECUTE')
  then raise exception 'AI_SOURCE_TIMEOUT_BASELINE_DRIFT';end if;
end $guard$;
alter function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)
 set statement_timeout='12s';
do $postflight$
declare f regprocedure:='public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure;
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=f)
   is distinct from '1d7ea5f8bb7f247c799f9e1fb98be86f616703de1258e1d5d3eeaffddb59da90'
  or (select proconfig from pg_proc where oid=f)
   is distinct from array['search_path=""','work_mem=16MB','statement_timeout=12s']
  or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
  or not has_function_privilege('service_role',f,'EXECUTE')
  then raise exception 'AI_SOURCE_TIMEOUT_BODY_OR_ACL_DRIFT';end if;
end $postflight$;
notify pgrst,'reload schema';
commit;
