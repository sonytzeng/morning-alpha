-- Candidate only. Production execution requires Sony's named approval.
-- Research provenance parity only: no business rows, triggers, ACL/RLS,
-- runtime state, Provider, Atomic, Retry or Cron changes.
begin;
do $migration$
declare
  target regprocedure := 'public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
  predecessor_md5 constant text := 'dffd21191ed005725a522801def74dac';
  old_fragment constant text := $old$       when 'sector_rotation_scores' then lower(btrim(v_source->>'freshness'))='previous_trading_day'$old$;
  new_fragment constant text := $new$       when 'authoritative_market_data_snapshots_v1' then lower(btrim(v_source->>'freshness'))='previous_trading_day'
         and v_source->>'source_date' ~ '^\d{4}-\d{2}-\d{2}$' and v_source->>'source_date'<p_report_date::text
       when 'sector_rotation_scores' then lower(btrim(v_source->>'freshness'))='previous_trading_day'$new$;
  before_catalog jsonb;
  after_catalog jsonb;
  definition text := pg_get_functiondef(target);
  predecessor text;
begin
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,
    'config',proconfig,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid))
    into before_catalog from pg_proc where oid=target;
  if md5(definition) <> predecessor_md5 then
    predecessor := replace(definition,new_fragment,old_fragment);
    if md5(predecessor)=predecessor_md5 and definition=replace(predecessor,old_fragment,new_fragment) then
      return; -- Exact reviewed successor only, never marker-based admission.
    end if;
    raise exception 'RESEARCH_PROVENANCE_UNREVIEWED_PREDECESSOR:%',md5(definition);
  end if;
  if length(definition)-length(replace(definition,old_fragment,'')) <> length(old_fragment) then
    raise exception 'RESEARCH_PROVENANCE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,old_fragment,new_fragment);
  if pg_get_functiondef(target) <> replace(definition,old_fragment,new_fragment) then
    raise exception 'RESEARCH_PROVENANCE_SUCCESSOR_MISMATCH';
  end if;
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,
    'config',proconfig,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid))
    into after_catalog from pg_proc where oid=target;
  if after_catalog is distinct from before_catalog then
    raise exception 'RESEARCH_PROVENANCE_CATALOG_DRIFT';
  end if;
end;
$migration$;
commit;
