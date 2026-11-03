-- Additive V4: bounded service-only COMPLETE validation performance correction.
-- Apply AFTER daily-ai-financial-refresh-v3. No source/model/review/rights/Cron changes.
-- Preserve full source provenance, selected observation IDs/counts, metadata and
-- parsed content equality. Group at issuer scope before comparing observations;
-- never join each of ~5,000 evidence rows to a repeatedly scanned wide CTE.
-- work_mem is function-local, not a global or member-read setting. Inputs remain
-- bounded by the original 72-company / 8MB SOURCE and 12MB batch contracts.
begin;

create function vnext_runtime.validate_daily_ai_intake_batch_evidence_v4(
 p_inputs jsonb,p_news jsonb,p_market jsonb,p_gaps jsonb,p_symbol_gaps jsonb,p_packets jsonb)
returns boolean language sql immutable set search_path='' set work_mem='16MB' as $$
with
 q as materialized(select p_inputs inputs,p_news news,p_market market,p_gaps intake_gaps,p_symbol_gaps gaps_by_symbol),
 b as materialized(select p_packets packets),
 inputs as materialized(select i->>'symbol' symbol,i from q,jsonb_array_elements(q.inputs)i),
 packets as materialized(select p->>'symbol' symbol,p from b,jsonb_array_elements(b.packets)p),
 scoped as materialized(select i.symbol,i.i,p.p from inputs i full join packets p using(symbol)),
 observations as materialized(
 select i.symbol,'PRICE' kind,bar x,session.ordinality rank from inputs i,
 lateral jsonb_array_elements_text(i.i->'expected_sessions') with ordinality session(date,ordinality),
 lateral jsonb_array_elements(i.i->'bars')bar where bar->>'date'=session.date and session.ordinality>greatest(jsonb_array_length(i.i->'expected_sessions')-20,0)
 union all select i.symbol,'FINANCIAL',fact.value,1000+fact.ordinality from inputs i,lateral jsonb_array_elements(i.i->'facts') with ordinality fact(value,ordinality)
 ),
 ranked as materialized(select *,row_number() over(partition by symbol order by rank) selected_rank from observations),
 expected as materialized(select symbol,symbol||':'||kind||':'||(x->>'id') eid,
 jsonb_build_object('id',symbol||':'||kind||':'||(x->>'id'),'symbol',symbol,'kind',kind,'source',x->>'source','published_at',x->'published_at',
 'available_at',x->>'available_at','first_seen_at',x->>'first_seen_at','as_of',x->>'as_of','evidence_hash',x->>'evidence_hash',
 'time_basis',case when x->'published_at'='null'::jsonb then 'OBSERVED_AFTER_RECEIPT' else 'PUBLISHED' end) metadata,
 case when kind='PRICE' then jsonb_build_object('date',x->'date','open',x->'open','high',x->'high','low',x->'low','close',x->'close','volume',x->'volume','amount',x->'amount','original_id',x->'id')
 ||case when x?'session_scope' then jsonb_build_object('session_scope',x->'session_scope') else '{}'::jsonb end
 else jsonb_build_object('kind',x->'kind','values',x->'values','original_id',x->'id')||case when x?'period' then jsonb_build_object('period',x->'period') else '{}'::jsonb end
 ||case when x?'basis' then jsonb_build_object('basis',x->'basis') else '{}'::jsonb end end content from ranked where selected_rank<=84),
 actual as materialized(select p.symbol,e->>'id' eid,e->>'kind' kind,e,e-'content' metadata,case when e->>'kind' in('PRICE','FINANCIAL') then (e->>'content')::jsonb else null end content from packets p,lateral jsonb_array_elements(p.p->'evidence')e),
 expected_groups as materialized(select symbol,jsonb_agg(metadata||jsonb_build_object('content',content) order by eid) rows from expected group by symbol),
 actual_groups as materialized(select symbol,jsonb_agg(metadata||jsonb_build_object('content',content) order by eid) rows from actual where kind in('PRICE','FINANCIAL') group by symbol),
 market_ids as materialized(select coalesce(jsonb_agg(m->>'id' order by m->>'id'),'[]'::jsonb) ids from q,jsonb_array_elements(q.market)m),
 actual_market_ids as materialized(select symbol,jsonb_agg(eid order by eid) ids from actual where kind='MARKET' group by symbol)
select coalesce(
 (select count(*)=72 and count(distinct symbol)=72 from inputs)
 and (select count(*)=72 and count(distinct symbol)=72 from packets)
 and not exists(select from scoped s cross join q where s.i is null or s.p is null or s.i->>'company' is distinct from s.p->>'company' or s.i->>'cutoff' is distinct from s.p->>'cutoff'
  or jsonb_typeof(s.p->'data_gaps') is distinct from 'array' or not(s.p->'data_gaps' @> q.intake_gaps) or not(s.p->'data_gaps' @> coalesce(q.gaps_by_symbol->s.symbol,'[]'::jsonb)))
 and not exists(select from expected_groups e full join actual_groups a using(symbol) where e.rows is distinct from a.rows)
 and not exists(select from actual a cross join q where coalesce(a.kind,'') not in('PRICE','FINANCIAL','NEWS','MARKET')
  or a.kind='NEWS' and not exists(select from jsonb_array_elements(q.news)n where n=a.e and(n->'symbol'='null'::jsonb or n->>'symbol'=a.symbol))
  or a.kind='MARKET' and not exists(select from jsonb_array_elements(q.market)m where m=a.e))
 and not exists(select from inputs i cross join market_ids e left join actual_market_ids a on a.symbol=i.symbol where e.ids is distinct from coalesce(a.ids,'[]'::jsonb)),false);
$$;
revoke all on function vnext_runtime.validate_daily_ai_intake_batch_evidence_v4(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.daily_stock_ai_intake_v1(p_op text,p_intake_id uuid,p_lease uuid default null,
 p_inputs jsonb default null,p_gaps jsonb default null,p_batch_id text default null,p_code text default null,p_symbol_gaps jsonb default null,p_market jsonb default null,p_financial_refresh jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set work_mem='16MB' as $$
declare q vnext_runtime.ai_stock_intakes;prior vnext_runtime.ai_stock_intakes;r vnext_runtime.runs;
 base jsonb;dirs jsonb;companies jsonb;frozen jsonb;final_inputs jsonb;gaps jsonb;item jsonb;old_item jsonb;b vnext_runtime.ai_stock_batches;
 at_time timestamptz:=clock_timestamp();cutoff_value timestamptz;financial_proof jsonb;
begin
 if p_op is null or p_op not in('CLAIM','SOURCE','COMPLETE','FAIL') or p_intake_id is null then raise exception 'AI_INTAKE_SCOPE';end if;
 select * into strict q from vnext_runtime.ai_stock_intakes where id=p_intake_id for update;
 if q.state='COMPLETE' then
  if p_op='COMPLETE' and p_batch_id is distinct from q.batch_id then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  return jsonb_build_object('state','CACHED','intake_id',q.id,'batch_id',q.batch_id,'member_published',false);
 end if;
 if p_op='CLAIM' then
  if q.state='SOURCED' then return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');end if;
  if q.business_date<>(at_time at time zone 'Asia/Taipei')::date then return jsonb_build_object('state','EXPIRED','intake_id',q.id,'member_published',false);end if;
  if q.state='RUNNING' and q.lease_until>at_time then return jsonb_build_object('state','BUSY','intake_id',q.id,'member_published',false);end if;
  if q.attempts>=3 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id,'member_published',false);end if;
  if q.base_inputs is null then
   select * into prior from vnext_runtime.ai_stock_intakes where id<>q.id and state in('SOURCED','COMPLETE')
    and cutoff<=at_time and business_date<q.business_date order by cutoff desc limit 1;
   select * into r from vnext_runtime.runs where source_revision ~ '^[a-f0-9]{64}$'
    and checkpoint->'acquired'->>'snapshot_hash'=source_revision and jsonb_typeof(checkpoint->'acquired'->'inputs')='array'
    and jsonb_array_length(checkpoint->'acquired'->'inputs')=72
    and (checkpoint->'acquired'->>'evidence_cutoff')::timestamptz<=at_time order by business_date desc,updated_at desc limit 1;
   if prior.id is not null and (r.id is null or prior.cutoff>=(r.checkpoint->'acquired'->>'evidence_cutoff')::timestamptz) then
    q.source_kind:='ASOF_INTAKE';q.source_id:=prior.id;q.source_revision:=prior.snapshot_hash;
    q.source_cutoff:=prior.cutoff_text;q.source_business_date:=prior.business_date;
    base:=vnext_runtime.project_daily_stock_ai_inputs_v1(prior.inputs);companies:=prior.companies;q.source_issues:=prior.source_issues;
   elsif r.id is not null then
    q.source_kind:='VNEXT_ACQUIRED';q.source_id:=r.id;q.source_revision:=r.source_revision;
    q.source_cutoff:=r.checkpoint->'acquired'->>'evidence_cutoff';q.source_business_date:=r.business_date;
    base:=vnext_runtime.project_daily_stock_ai_inputs_v1(r.checkpoint->'acquired'->'inputs');
    q.source_issues:=coalesce(r.checkpoint->'acquired'->'source_issues','[]'::jsonb);
    select coalesce(jsonb_agg(x),'[]'::jsonb) into dirs from vnext_runtime.run_sources rs
     join vnext_runtime.source_revisions sr on sr.id=rs.source_id,
     lateral jsonb_array_elements(sr.receipt->'payload'->'rows')x
     where rs.run_id=r.id and sr.receipt->'task'->>'kind'='DIRECTORY' and sr.receipt->>'status'='OK';
    select jsonb_agg(jsonb_build_object('symbol',i->>'symbol','company',i->>'company','exchange',d.exchange) order by i->>'symbol') into companies
     from jsonb_array_elements(base)i cross join lateral(select min(x->>'exchange') exchange from jsonb_array_elements(dirs)x
      where x->>'symbol'=i->>'symbol' having count(distinct x->>'exchange')=1 and min(x->>'exchange') in('TWSE','TPEX'))d;
   else return jsonb_build_object('state','SOURCE_UNAVAILABLE','intake_id',q.id,'member_published',false);end if;
   if jsonb_array_length(companies) is distinct from 72 or (select count(distinct x->>'symbol') from jsonb_array_elements(base)x)<>72 then raise exception 'AI_INTAKE_BASE_UNIVERSE';end if;
   q.base_inputs:=base;q.companies:=companies;
  end if;
  update vnext_runtime.ai_stock_intakes set state='RUNNING',attempts=attempts+1,lease=gen_random_uuid(),lease_until=at_time+interval '120 seconds',
   source_kind=q.source_kind,source_id=q.source_id,source_revision=q.source_revision,source_cutoff=q.source_cutoff,source_business_date=q.source_business_date,
   base_inputs=q.base_inputs,companies=q.companies,source_issues=q.source_issues,intake_gaps='["RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED","FINANCIAL_DATA_RETAINED_NOT_REFRESHED","INSTITUTIONAL_FLOW_NOT_REFRESHED","CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY"]',
   last_code=null,updated_at=at_time where id=q.id;
  return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'ACQUIRED');
 end if;
 if p_lease is null or p_lease is distinct from q.lease then raise exception 'AI_INTAKE_LEASE';end if;
 if p_op='COMPLETE' then
  if q.state<>'SOURCED' or p_batch_id is null then raise exception 'AI_INTAKE_NOT_SOURCED';end if;
  select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
  if b.cutoff<>q.cutoff or jsonb_array_length(b.payload->'packets')<>72 or b.payload->>'through' is distinct from q.inputs->0->>'through'
   or b.payload->'source_handoff' is not null
   or b.payload->'source_intake' is distinct from jsonb_build_object('intake_id',q.id,'snapshot_hash',q.snapshot_hash,
    'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff,
    'source_business_date',q.source_business_date,'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1')
   then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  -- Keep the original scope/error contract, but expand the wide retained input
  -- once into a compact identity relation instead of spilling it 72 times.
  if exists(with input_scope as materialized(select i->>'symbol' symbol,i->>'company' company,i->>'cutoff' cutoff from jsonb_array_elements(q.inputs)i)
   select from jsonb_array_elements(b.payload->'packets')p where not exists(select from input_scope i
    where i.symbol=p->>'symbol' and i.company=p->>'company' and i.cutoff=p->>'cutoff')) then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  if exists(select from jsonb_array_elements(b.payload->'packets')p where jsonb_typeof(p->'data_gaps') is distinct from 'array'
   or not(p->'data_gaps' @> q.intake_gaps) or not(p->'data_gaps' @> coalesce(q.gaps_by_symbol->(p->>'symbol'),'[]'::jsonb))) then raise exception 'AI_INTAKE_GAPS_OMITTED';end if;
  if not vnext_runtime.validate_daily_ai_intake_batch_evidence_v4(q.inputs,q.news,q.market,q.intake_gaps,q.gaps_by_symbol,b.payload->'packets')
   then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
  update vnext_runtime.ai_stock_intakes set state='COMPLETE',batch_id=b.id,updated_at=clock_timestamp() where id=q.id;
  return jsonb_build_object('state','COMPLETE','intake_id',q.id,'batch_id',b.id,'member_published',false);
 end if;
 if q.state='SOURCED' and p_op='SOURCE' then return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');end if;
 if q.state<>'RUNNING' or q.lease_until<=at_time then raise exception 'AI_INTAKE_LEASE';end if;
 if p_op='FAIL' then
  if p_code is null or p_code !~ '^AI_INTAKE_[A-Z0-9_]{1,80}$' then raise exception 'AI_INTAKE_CODE';end if;
  update vnext_runtime.ai_stock_intakes set state='FAILED',last_code=p_code,lease_until=at_time,updated_at=at_time where id=q.id;
  return jsonb_build_object('state','FAILED','intake_id',q.id,'member_published',false);
 end if;
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 or octet_length(p_inputs::text)>8000000
  or (select count(distinct x->>'symbol') from jsonb_array_elements(p_inputs)x)<>72
  or jsonb_typeof(coalesce(p_gaps,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_gaps,'[]'::jsonb))>30
  or exists(select from jsonb_array_elements(coalesce(p_gaps,'[]'::jsonb))g where jsonb_typeof(g)<>'string' or (g#>>'{}') !~ '^[A-Z][A-Z0-9_]{0,99}$')
  or jsonb_typeof(coalesce(p_symbol_gaps,'{}'::jsonb))<>'object' then raise exception 'AI_INTAKE_INPUTS';end if;
 if p_symbol_gaps is not null and p_symbol_gaps<>'{}'::jsonb and ((select count(*) from jsonb_object_keys(p_symbol_gaps))<>72
  or exists(select from jsonb_each(p_symbol_gaps)sg where not exists(select from jsonb_array_elements(q.base_inputs)i where i->>'symbol'=sg.key)
   or jsonb_typeof(sg.value)<>'array' or jsonb_array_length(sg.value)>20 or exists(select from jsonb_array_elements(sg.value)g
    where jsonb_typeof(g)<>'string' or (g#>>'{}') !~ '^[A-Z][A-Z0-9_]{0,99}$'))) then raise exception 'AI_INTAKE_SYMBOL_GAPS';end if;
 for item in select * from jsonb_array_elements(p_inputs) loop
  select x into strict old_item from jsonb_array_elements(q.base_inputs)x where x->>'symbol'=item->>'symbol';
  if item->>'company' is distinct from old_item->>'company'
   or coalesce(item->>'through','') !~ '^\d{4}-\d\d-\d\d$' or item->>'through'<old_item->>'through' or item->>'through'>(q.business_date::text)
   or jsonb_typeof(item->'expected_sessions') is distinct from 'array' or jsonb_array_length(item->'expected_sessions')>250
   or jsonb_typeof(item->'bars') is distinct from 'array' or jsonb_array_length(item->'bars')>250
   or exists(select from jsonb_array_elements(old_item->'bars')ob where item->'expected_sessions' ? (ob->>'date')
    and not exists(select from jsonb_array_elements(item->'bars')nb where nb=ob)) then raise exception 'AI_INTAKE_RETAINED_BYTES';end if;
 end loop;
 if (select count(distinct i->>'through') from jsonb_array_elements(p_inputs)i)<>1 then raise exception 'AI_INTAKE_THROUGH';end if;
 frozen:=vnext_runtime.freeze_daily_stock_ai_news_v1(p_inputs);cutoff_value:=(frozen->>'cutoff')::timestamptz;
 if (cutoff_value at time zone 'Asia/Taipei')::date<>q.business_date then raise exception 'AI_INTAKE_DATE_EXPIRED';end if;
 financial_proof:=vnext_runtime.validate_daily_ai_financial_refresh_v3(q.base_inputs,p_inputs,p_financial_refresh,cutoff_value,q.business_date);
 if not vnext_runtime.validate_daily_ai_market_v1(coalesce(p_market,'[]'::jsonb),cutoff_value,q.business_date) then raise exception 'AI_INTAKE_MARKET';end if;
 if exists(select from jsonb_array_elements(p_inputs)i,jsonb_array_elements((i->'bars')||(i->'facts'))tr
  where tr->>'available_at' is null or not isfinite((tr->>'available_at')::timestamptz) or (tr->>'available_at')::timestamptz>cutoff_value)
  then raise exception 'AI_INTAKE_FUTURE_RECEIPT';end if;
 select jsonb_agg(i||jsonb_build_object('cutoff',frozen->>'cutoff') order by i->>'symbol') into final_inputs from jsonb_array_elements(p_inputs)i;
 final_inputs:=vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs);
 select jsonb_agg(to_jsonb(code) order by code) into gaps from(select distinct value#>>'{}' code from jsonb_array_elements(q.intake_gaps||coalesce(p_gaps,'[]'::jsonb)||
  '["NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE","NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS","NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES","NEWS_COMPANY_ASSOCIATION_REQUIRES_VERIFICATION"]'::jsonb||
  case when jsonb_array_length(coalesce(p_market,'[]'::jsonb))=0 then '["MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE"]'::jsonb else '[]'::jsonb end||
  case when jsonb_array_length(frozen->'news')=0 then '["NEWS_NONE_AVAILABLE_WITHIN_48H"]'::jsonb else '[]'::jsonb end))all_gaps;
 update vnext_runtime.ai_stock_intakes set state='SOURCED',financial_refresh=financial_proof,inputs=final_inputs,news=frozen->'news',market=coalesce(p_market,'[]'::jsonb),cutoff=cutoff_value,cutoff_text=frozen->>'cutoff',intake_gaps=gaps,
  gaps_by_symbol=coalesce(p_symbol_gaps,'{}'::jsonb),snapshot_hash=encode(sha256(convert_to(jsonb_build_object(
   'schema','DAILY_AI_INTAKE_SNAPSHOT_V1','financial_refresh',financial_proof,'inputs',final_inputs,'news',frozen->'news','market',coalesce(p_market,'[]'::jsonb),'cutoff',frozen->>'cutoff',
   'intake_gaps',gaps,'gaps_by_symbol',coalesce(p_symbol_gaps,'{}'::jsonb),'source_issues',q.source_issues,
   'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff)::text,'UTF8')),'hex'),updated_at=clock_timestamp() where id=q.id;
 return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');
end $$;
revoke all on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) to service_role;
commit;
