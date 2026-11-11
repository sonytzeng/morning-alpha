-- LOCAL CANDIDATE. Explicit aggregate corporate-action proof admission.
-- Ordinary per-row evidence validation is copied byte-for-byte from its guarded
-- predecessor. An aggregate's absence assertion is recomputed from all retained
-- source rows. This creates no review, license, price plan or publication.
begin;
do $$declare definition text;begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_packet(jsonb,text,text)'))
   is distinct from 'e2c9c3472685027640a271e8a070552d'
  or to_regclass('vnext_market.action_rows') is null or to_regclass('vnext_market.action_evidence') is not null
  or to_regprocedure('vnext_market.validate_packet_rows_v2(jsonb,text,text)') is not null
  then raise exception 'MARKET_ACTION_AGGREGATE_BASELINE';end if;
 definition:=pg_get_functiondef('vnext_market.validate_packet(jsonb,text,text)'::regprocedure);
 if strpos(definition,'FUNCTION vnext_market.validate_packet(')=0 then raise exception 'MARKET_ACTION_AGGREGATE_DEFINITION';end if;
 execute replace(definition,'FUNCTION vnext_market.validate_packet(','FUNCTION vnext_market.validate_packet_rows_v2(');
end $$;

create table vnext_market.action_evidence(
 evidence_hash text primary key check(evidence_hash~'^[a-f0-9]{64}$'),
 coverage_hash text not null check(coverage_hash~'^[a-f0-9]{64}$'),
 universe_id text not null references vnext_market.universes(id),security_id text not null,
 content_text text not null,body jsonb not null,available_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table vnext_market.action_evidence enable row level security;
alter table vnext_market.action_evidence force row level security;
revoke all on table vnext_market.action_evidence from public,anon,authenticated,service_role;
create trigger market_action_evidence_immutable before update or delete on vnext_market.action_evidence
 for each row execute function vnext_market.immutable();

create function vnext_market.validate_action_evidence(p_evidence jsonb,p_security_id text,p_plan_id text) returns void
language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;c vnext_market.companies;d jsonb;b jsonb;expected_binding jsonb;expected jsonb;
 cap vnext_market.captures;tab vnext_market.action_capture_tables;old_e vnext_market.action_evidence;
 source_key text;source_keys text[]:=array['tpex_ex_right','tpex_capital_reduction','tpex_par_value_change'];
 source_count integer:=0;from_day date;through_day date;indices jsonb;issues text[]:='{}';reason text;event_kind text;
 source_bindings jsonb:='[]';events jsonb:='[]';event_body jsonb;raw_record record;source_binding jsonb;
 available_time timestamptz;available_text text;primary_source text;complete boolean;
begin
 select * into strict p from vnext_market.work_plans where id=p_plan_id;
 select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=p_security_id;
 if not coalesce(vnext_market.exact(p_evidence,array['id','symbol','kind','source','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash','content']),false)
  or p_evidence->>'symbol' is distinct from c.symbol or p_evidence->>'kind' is distinct from 'FINANCIAL'
  or jsonb_typeof(p_evidence->'content') is distinct from 'string' or length(p_evidence->>'content') not between 2 and 200000
  or p_evidence->>'evidence_hash' is distinct from vnext_market.digest(p_evidence->>'content')
  then raise exception 'MARKET_ACTION_EVIDENCE_HASH';end if;
 d:=(p_evidence->>'content')::jsonb;
 if not coalesce(vnext_market.exact(d,array['schema','kind','security_id','market','symbol','universe_hash','cutoff','price_basis','from','through','status',
   'complete','coverage_kinds','source_bindings','events','issues','available_at','coverage_scope','historical_membership_established',
   'adjustment_applied','cash_entitlement_inferred','source_use_approval','coverage_hash']),false)
  or d->>'schema' is distinct from 'TAIWAN_MARKET_ACTION_COVERAGE_V1' or c.market<>'TPEX'
  or d->>'security_id' is distinct from p_security_id or d->>'symbol' is distinct from c.symbol or d->>'market' is distinct from c.market
  or d->>'universe_hash' is distinct from p.universe_id or jsonb_typeof(d->'cutoff') is distinct from 'string'
  or (d->>'cutoff')::timestamptz is distinct from p.cutoff
  or coalesce(d->>'from','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or coalesce(d->>'through','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(d->'source_bindings') is distinct from 'array' or jsonb_array_length(d->'source_bindings') not between 1 and 3
  or (select count(distinct x->>'source_id') from jsonb_array_elements(d->'source_bindings')x)<>jsonb_array_length(d->'source_bindings')
  or exists(select from jsonb_array_elements(d->'source_bindings')x where coalesce(x->>'source_id','')<>all(source_keys))
  then raise exception 'MARKET_ACTION_AGGREGATE_SCOPE';end if;
 from_day:=(d->>'from')::date;through_day:=(d->>'through')::date;
 if from_day>through_day or through_day-from_day>550 then raise exception 'MARKET_ACTION_AGGREGATE_RANGE';end if;
 foreach source_key in array source_keys loop
  select x into b from jsonb_array_elements(d->'source_bindings')x where x->>'source_id'=source_key;
  if not found then issues:=array_append(issues,'MISSING_'||upper(source_key));continue;end if;
  select * into cap from vnext_market.captures where id=b->>'capture_id' and source_id=source_key;
  if not found or cap.received_at>p.cutoff then raise exception 'MARKET_ACTION_CAPTURE_SCOPE';end if;
  select * into strict tab from vnext_market.action_capture_tables where capture_id=cap.id and source_id=source_key;
  select coalesce(jsonb_agg(a.row_index order by a.row_index),'[]'::jsonb) into indices
   from vnext_market.action_rows a where a.capture_id=cap.id and a.symbol=c.symbol and a.effective_date between from_day and through_day;
  expected_binding:=jsonb_build_object('capture_id',cap.id,'source_id',source_key,'source_url',cap.source_url,
   'source_sha256',cap.body_sha256,'source_bytes',cap.body_bytes,'received_at',cap.receipt->>'received_at',
   'source_from',tab.source_from,'source_through',tab.source_through,'table_path',jsonb_build_array('tables',0),
   'table_hash',tab.table_hash,'fields_hash',tab.fields_hash,'row_count',tab.row_count,'matched_row_indices',indices,'coverage_kinds',tab.coverage_kinds);
  if b is distinct from expected_binding then raise exception 'MARKET_ACTION_COMPLETE_TABLE_BINDING';end if;
  source_bindings:=source_bindings||jsonb_build_array(expected_binding);source_count:=source_count+1;
  if tab.source_from>from_day or tab.source_through<through_day then issues:=array_append(issues,'INCOMPLETE_RANGE_'||upper(source_key));end if;
  if not tab.source_through_observed then issues:=array_append(issues,'UNOBSERVED_RANGE_END_'||upper(source_key));end if;
  if available_time is null or cap.received_at>=available_time then available_time:=cap.received_at;available_text:=cap.receipt->>'received_at';end if;
  if primary_source is null then primary_source:=cap.source_url;end if;
  for raw_record in select a.row_index,a.row_hash,a.derived,r.row_body from vnext_market.action_rows a
   join vnext_market.capture_rows r on r.capture_id=a.capture_id and r.row_path=array['tables','0','data',a.row_index::text]
   where a.capture_id=cap.id and a.symbol=c.symbol and a.effective_date between from_day and through_day order by a.row_index loop
   for reason in select jsonb_array_elements_text(raw_record.derived->'issues') loop
    issues:=array_append(issues,source_key||':'||raw_record.row_index||':'||reason);
   end loop;
   source_binding:=jsonb_build_object('capture_id',cap.id,'source_id',source_key,'source_url',cap.source_url,
    'source_sha256',cap.body_sha256,'source_bytes',cap.body_bytes,'received_at',cap.receipt->>'received_at',
    'row_index',raw_record.row_index,'row_path',jsonb_build_array('tables',0,'data',raw_record.row_index),'symbol_field','1','source_row_hash',raw_record.row_hash);
   for event_kind in select jsonb_array_elements_text(raw_record.derived->'kinds') loop
    event_body:=jsonb_build_object('symbol',c.symbol,'effective_date',raw_record.derived->>'effective_date','kind',event_kind,
     'subtype',raw_record.derived->>'subtype','source_ref',cap.source_url,'available_at',cap.receipt->>'received_at',
     'source_capture',source_binding,'raw_row',raw_record.row_body,'suspension_from',raw_record.derived->'suspension_from',
     'reported',raw_record.derived->'reported','classification',case when jsonb_array_length(raw_record.derived->'issues')=0 then 'CLASSIFIED' else 'UNCLASSIFIED' end);
    events:=events||jsonb_build_array(event_body||jsonb_build_object('event_id',vnext_market.hash(event_body)));
   end loop;
  end loop;
 end loop;
 select coalesce(jsonb_agg(x order by x->>'effective_date' collate "C",x->>'kind' collate "C",x->>'event_id' collate "C"),'[]'::jsonb)
  into events from jsonb_array_elements(events)x;
 select coalesce(array_agg(s.reason order by s.ord),'{}'::text[]) into issues
  from(select value reason,min(ord) ord from unnest(issues) with ordinality q(value,ord) group by value)s;
 complete:=source_count=3 and cardinality(issues)=0;
 expected:=jsonb_build_object('schema','TAIWAN_MARKET_ACTION_COVERAGE_V1','kind',case when complete then 'CORPORATE_ACTION_COVERAGE' else 'CORPORATE_ACTION_INVENTORY' end,
  'security_id',p_security_id,'market',c.market,'symbol',c.symbol,'universe_hash',p.universe_id,'cutoff',d->>'cutoff',
  'price_basis','RAW_UNADJUSTED','from',from_day,'through',through_day,'status',case when complete then case when jsonb_array_length(events)>0 then 'EVENTS' else 'NO_ACTIONS' end else 'INCOMPLETE' end,
  'complete',complete,'coverage_kinds','["CASH_DIVIDEND","STOCK_DIVIDEND","SPLIT","RIGHTS","CAPITAL_REDUCTION"]'::jsonb,
  'source_bindings',source_bindings,'events',events,'issues',to_jsonb(issues),'available_at',available_text,
  'coverage_scope','TPEX_FIVE_EFFECTIVE_ACTION_CLASSES_AS_OF_SOURCE_RECEIPT','historical_membership_established',false,
  'adjustment_applied',false,'cash_entitlement_inferred',false,'source_use_approval',null);
 expected:=expected||jsonb_build_object('coverage_hash',vnext_market.hash(expected));
 if d is distinct from expected then raise exception 'MARKET_ACTION_COVERAGE_RECOMPUTATION';end if;
 if p_evidence->>'id' is distinct from 'tpex-actions-'||left(expected->>'coverage_hash',40)
  or p_evidence->>'source' is distinct from primary_source or p_evidence->'published_at' is distinct from 'null'::jsonb
  or p_evidence->>'time_basis' is distinct from 'OBSERVED_AFTER_RECEIPT'
  or p_evidence->>'available_at' is distinct from available_text or p_evidence->>'first_seen_at' is distinct from available_text
  or p_evidence->>'as_of' is distinct from available_text
  then raise exception 'MARKET_ACTION_EVIDENCE_TIME';end if;
 select * into old_e from vnext_market.action_evidence where evidence_hash=p_evidence->>'evidence_hash';
 if found then
  if old_e.body is distinct from p_evidence or old_e.content_text is distinct from p_evidence->>'content' then raise exception 'MARKET_ACTION_EVIDENCE_REPLAY';end if;
 else
  insert into vnext_market.action_evidence(evidence_hash,coverage_hash,universe_id,security_id,content_text,body,available_at)
   values(p_evidence->>'evidence_hash',d->>'coverage_hash',p.universe_id,p_security_id,p_evidence->>'content',p_evidence,available_time);
 end if;
 insert into vnext_market.plan_sources(plan_id,source_url) select p.id,x->>'source_url' from jsonb_array_elements(source_bindings)x on conflict do nothing;
end $$;

-- Keep the original function OID so existing shard functions call this wrapper.
create or replace function vnext_market.validate_packet(p_packet jsonb,p_security_id text,p_plan_id text) returns void
language plpgsql security definer set search_path='' as $$
declare ordinary jsonb:='[]';aggregates jsonb:='[]';e jsonb;content jsonb;begin
 if jsonb_typeof(p_packet->'evidence') is distinct from 'array' or jsonb_array_length(p_packet->'evidence') not between 1 and 100
  or (select count(distinct x->>'id') from jsonb_array_elements(p_packet->'evidence')x)<>jsonb_array_length(p_packet->'evidence')
  then raise exception 'MARKET_PACKET_SCOPE';end if;
 for e in select jsonb_array_elements(p_packet->'evidence') loop
  if jsonb_typeof(e->'content') is distinct from 'string' then raise exception 'MARKET_EVIDENCE_HASH';end if;
  content:=(e->>'content')::jsonb;
  if content->>'schema'='TAIWAN_MARKET_ACTION_COVERAGE_V1' then aggregates:=aggregates||jsonb_build_array(e);
  else ordinary:=ordinary||jsonb_build_array(e);end if;
 end loop;
 perform vnext_market.validate_packet_rows_v2(jsonb_set(p_packet,'{evidence}',ordinary),p_security_id,p_plan_id);
 for e in select jsonb_array_elements(aggregates) loop perform vnext_market.validate_action_evidence(e,p_security_id,p_plan_id);end loop;
end $$;
revoke all on function vnext_market.validate_packet_rows_v2(jsonb,text,text),vnext_market.validate_action_evidence(jsonb,text,text),
 vnext_market.validate_packet(jsonb,text,text) from public,anon,authenticated,service_role;
commit;
