begin;
create table vnext_runtime.ai_stock_batches(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),cutoff timestamptz not null,
 payload_text text not null check(octet_length(payload_text) between 2 and 12000000),payload jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 check(encode(sha256(convert_to(payload_text,'UTF8')),'hex')=id),check(cutoff<=created_at)
);
alter table vnext_runtime.ai_stock_batches enable row level security;
alter table vnext_runtime.ai_stock_batches force row level security;
revoke all on vnext_runtime.ai_stock_batches from public,anon,authenticated,service_role;
create trigger ai_stock_batches_immutable before update or delete on vnext_runtime.ai_stock_batches
 for each row execute function vnext_runtime.immutable();

create function public.store_daily_stock_ai_batch_v1(p_text text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;item record;p jsonb;e jsonb;packets jsonb:='[]';at_time timestamptz:=clock_timestamp();
begin
 if p_text is null or octet_length(p_text) not between 2 and 12000000 or p_hash is null
  or encode(sha256(convert_to(p_text,'UTF8')),'hex')<>p_hash then raise exception 'AI_INPUT_HASH';end if;
 v:=p_text::jsonb;
 if v->>'schema' is distinct from 'DAILY_AI_BATCH_INPUT_V1'
  or jsonb_typeof(v->'packet_texts') is distinct from 'object' or jsonb_typeof(v->'packet_hashes') is distinct from 'object'
  or (select count(*) from jsonb_object_keys(v->'packet_texts'))<>72
  or (select count(*) from jsonb_object_keys(v->'packet_hashes'))<>72
  or (v->>'cutoff')::timestamptz>at_time or not isfinite((v->>'cutoff')::timestamptz)
  or (v->>'through')::date>((v->>'cutoff')::timestamptz at time zone 'Asia/Taipei')::date
 then raise exception 'AI_INPUT_SCOPE';end if;
 for item in select * from jsonb_each_text(v->'packet_texts') order by key loop
  p:=item.value::jsonb;
  if item.key !~ '^\d{4,6}$' or p->>'symbol' is distinct from item.key
   or p->>'cutoff' is distinct from v->>'cutoff' or p->>'data_through' is distinct from v->>'through'
   or encode(sha256(convert_to(item.value,'UTF8')),'hex') is distinct from v->'packet_hashes'->>item.key
   or length(coalesce(p->>'company','')) not between 1 and 100
   or jsonb_typeof(p->'evidence') is distinct from 'array' or jsonb_array_length(p->'evidence') not between 1 and 100
   then raise exception 'AI_INPUT_PACKET';end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p->'evidence')x)<>jsonb_array_length(p->'evidence') then raise exception 'AI_INPUT_EVIDENCE_ID';end if;
  for e in select * from jsonb_array_elements(p->'evidence') loop
   if coalesce(e->>'kind','') not in('NEWS','MARKET','FINANCIAL','PRICE')
    or coalesce(e->>'id','')='' or e->>'symbol' is not null and e->>'symbol'<>item.key
    or coalesce(e->>'source','') !~ '^https://[^/?#@[:space:]]+([/?]|$)'
    or e->>'source' ~ '[#[:space:]]' or e->>'source' ~* '[?&][^=]*(token|secret|key|auth|email)[^=]*='
    or length(coalesce(e->>'content','')) not between 1 and 12000
    or e->>'available_at' is null or not isfinite((e->>'available_at')::timestamptz)
    or (e->>'available_at')::timestamptz>(v->>'cutoff')::timestamptz
    then raise exception 'AI_INPUT_EVIDENCE';end if;
   if e->>'published_at' is null then
    if e->>'time_basis' is distinct from 'OBSERVED_AFTER_RECEIPT' or e->>'first_seen_at' is null or e->>'as_of' is null
     or coalesce(e->>'evidence_hash','') !~ '^[a-f0-9]{64}$'
     or not isfinite((e->>'first_seen_at')::timestamptz) or not isfinite((e->>'as_of')::timestamptz)
     or (e->>'first_seen_at')::timestamptz>(e->>'available_at')::timestamptz
     or (e->>'as_of')::timestamptz>(e->>'available_at')::timestamptz then raise exception 'AI_INPUT_RECEIPT';end if;
   elsif not isfinite((e->>'published_at')::timestamptz) or (e->>'published_at')::timestamptz>(e->>'available_at')::timestamptz then raise exception 'AI_INPUT_PUBLISHED_TIME';end if;
  end loop;
  packets:=packets||jsonb_build_array(p);
 end loop;
 insert into vnext_runtime.ai_stock_batches(id,cutoff,payload_text,payload)
 values(p_hash,(v->>'cutoff')::timestamptz,p_text,v||jsonb_build_object('packets',packets)) on conflict do nothing;
 return jsonb_build_object('state','STORED','batch_id',p_hash,'packets',72,'member_published',false);
end $$;
revoke all on function public.store_daily_stock_ai_batch_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.store_daily_stock_ai_batch_v1(text,text) to service_role;

create function public.load_daily_stock_ai_batch_v1(p_batch_id text default null,p_cutoff timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;
begin
 if (p_batch_id is null)=(p_cutoff is null) then raise exception 'AI_INPUT_SELECTOR';end if;
 select * into b from vnext_runtime.ai_stock_batches where
  (p_batch_id is null or id=p_batch_id) and (p_cutoff is null or cutoff=p_cutoff) order by created_at desc,id limit 1;
 if not found then return null;end if;
 return jsonb_build_object('id',b.id,'cutoff',b.payload->>'cutoff','packets',b.payload->'packets');
end $$;
revoke all on function public.load_daily_stock_ai_batch_v1(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_batch_v1(text,timestamptz) to service_role;

-- Read only actual completed jobs belonging to this retained batch and model.
-- One bounded lookup avoids repeating a network CLAIM for every completed stock.
create function public.load_daily_stock_ai_progress_v1(p_batch_id text,p_model_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;completed jsonb;
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$'
  or p_model_revision is null or length(btrim(p_model_revision))=0 or length(p_model_revision)>200
  then raise exception 'AI_PROGRESS_SCOPE';end if;
 select * into b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 if not found then raise exception 'AI_PROGRESS_BATCH_MISSING';end if;
 select coalesce(jsonb_object_agg(j.id,j.result),'{}'::jsonb) into completed
 from jsonb_each_text(b.payload->'packet_hashes') packet
 join vnext_runtime.ai_stock_jobs j on j.symbol=packet.key and j.input_hash=packet.value
 where j.cutoff=b.cutoff and j.model_revision=p_model_revision and j.state='COMPLETE';
 return jsonb_build_object('schema','DAILY_AI_PROGRESS_V1','batch_id',b.id,
  'model_revision',p_model_revision,'completed',completed);
end $$;
revoke all on function public.load_daily_stock_ai_progress_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_progress_v1(text,text) to service_role;
commit;
