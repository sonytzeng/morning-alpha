-- Exact guarded dispatcher change only. No dispatch, job mutation, grants or publication.
-- Affected immutable batches remain blocked until separately reviewed recovery.
begin;
do $dispatcher_rate_limit$
declare
 v_oid oid := pg_catalog.to_regprocedure('public.dispatch_daily_stock_ai_batch_v1(text)');
 v_definition text;v_metadata jsonb;
 v_old text := $old_patch$ -- A provider rate-limit failure blocks automatic continuation for this exact
 -- immutable packet scope. Recovery requires a separately reviewed path;
 -- no job attempts/results, model revision, token, grants or dispatch rows change.
 if exists(select from vnext_runtime.ai_stock_batches b
  cross join lateral pg_catalog.jsonb_each_text(b.payload->'packet_hashes') packet
  join vnext_runtime.ai_stock_jobs j on j.symbol=packet.key and j.input_hash=packet.value and j.cutoff=b.cutoff
  where b.id=p_batch_id and j.code='STOCK_AI_PROVIDER_HTTP_429') then
  return jsonb_build_object('state','BLOCKED_PROVIDER_RATE_LIMIT','batch_id',p_batch_id,'member_published',false);
 end if;
 if (select count(*) from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id)>=216 then$old_patch$;
 v_new text := $new_patch$ if (select count(*) from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id)>=216 then$new_patch$;
begin
 if v_oid is null then raise exception 'AI_DISPATCH_429_ROLLBACK_BASELINE_MISSING';end if;
 select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_definition,'UTF8')),'hex')
  is distinct from 'd0c3395e030c92b8cd55cedb53882fbb86cc07b37ac57c0d4b007db623467878' then raise exception 'AI_DISPATCH_429_ROLLBACK_BASELINE_DRIFT';end if;
 if not exists(select from pg_catalog.pg_proc p where p.oid=v_oid
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.provolatile='v' and p.prosecdef
  and p.proconfig=array['search_path=""']::text[]
  and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  and p.prokind='f' and not p.proisstrict and not p.proleakproof and p.proparallel='u'
  and p.prolang=(select l.oid from pg_catalog.pg_language l where l.lanname='plpgsql')) then raise exception 'AI_DISPATCH_429_ROLLBACK_PRIVILEGE_DRIFT';end if;
 select pg_catalog.to_jsonb(p)-'prosrc' into v_metadata from pg_catalog.pg_proc p where p.oid=v_oid;
 if (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
  /pg_catalog.length(v_old)<>1 then raise exception 'AI_DISPATCH_429_ROLLBACK_PATCH_NOT_EXACT';end if;
 execute pg_catalog.replace(v_definition,v_old,v_new);
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(v_oid),'UTF8')),'hex')
  is distinct from '436ec37a8a6d32169bd1bab60ebf9bc4338845588f19efac7de78a4384387db3' then raise exception 'AI_DISPATCH_429_ROLLBACK_RESULT_DRIFT';end if;
 if (select pg_catalog.to_jsonb(p)-'prosrc' from pg_catalog.pg_proc p where p.oid=v_oid)
  is distinct from v_metadata then raise exception 'AI_DISPATCH_429_ROLLBACK_METADATA_CHANGED';end if;
end
$dispatcher_rate_limit$;
commit;
