-- LOCAL ROLLBACK. Restore only the exact pre-BVPS reference entry point.
-- Preserve every immutable capture, verification, reference, review and edition.
begin;
do $patch$declare definition text;begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_references_v2(text,text,text)')) is distinct from '71fe131c114760f4373f0b7cc5881d40'
  then raise exception 'MARKET_BVPS_REFERENCE_BASELINE';end if;
 definition:=pg_get_functiondef('public.stage_daily_ai_market_price_references_v2(text,text,text)'::regprocedure);
 definition:=replace(definition,'or (ref_horizon=''MEDIUM'' and not coalesce((coalesce(method,'''') in(''CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'',''CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'') and version=''TAIWAN_PEER_RERATING_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false))','or (ref_horizon=''MEDIUM'' and (coalesce(method,'''') not in(''CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'',''CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'') or version is distinct from ''TAIWAN_PEER_RERATING_V1''))');
 definition:=replace(definition,'or (ref_horizon=''LONG'' and not coalesce((method=''CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'' and version=''TAIWAN_LONG_QUALITY_PEER_PB_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false))','or (ref_horizon=''LONG'' and (method is distinct from ''CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'' or version is distinct from ''TAIWAN_LONG_QUALITY_PEER_PB_V1''))');
 definition:=replace(definition,'  if version=''TAIWAN_REPORTED_BVPS_PEER_V1'' then perform vnext_market.bvps_validate_reference(full_ref,ref_horizon,p.id);end if;
','');
 execute definition;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_references_v2(text,text,text)')) is distinct from 'c4afbf11bf17d4b418df812d063aa43d'
  then raise exception 'MARKET_BVPS_REFERENCE_PATCH_RESULT';end if;
end $patch$;
do $projection$declare definition text;begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.reference_projection(text,text,text,text,text,text)')) is distinct from '886c09fa20182876261b9b28f6d1dd97' then raise exception 'MARKET_BVPS_PROJECTION_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure);
 execute replace(definition,' end if;
 perform vnext_market.bvps_validate_projection(p_plan_hash,p_security_id,refs,p_packet_text,p_packet_hash);
 return refs;',' end if;return refs;');
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.reference_projection(text,text,text,text,text,text)')) is distinct from '780f953c71839db6d80a4fdbbb6be006' then raise exception 'MARKET_BVPS_PROJECTION_PATCH_RESULT';end if;
end $projection$;
revoke all on function vnext_market.bvps_number(text),
 vnext_market.bvps_near(jsonb,numeric),
 vnext_market.bvps_field(jsonb,jsonb,text[]),
 vnext_market.bvps_financial_row(text,text,jsonb,text,text),
 vnext_market.bvps_validate_observation(text,text,jsonb),
 vnext_market.bvps_validate_actions(text,text,jsonb,date,date),
 vnext_market.bvps_validate_quality(text,text,jsonb),
 vnext_market.bvps_completed_session(timestamptz),
 vnext_market.bvps_validate_reference(jsonb,text,text),
 vnext_market.bvps_validate_projection(text,text,jsonb,text,text),
 vnext_market.reference_projection(text,text,text,text,text,text)
 from public,anon,authenticated,service_role;
revoke all on table vnext_market.bvps_verified_inputs,vnext_market.bvps_reference_packet_bindings from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_price_references_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_price_references_v2(text,text,text) to service_role;
commit;
