-- Private paid-response audit for actual independent semantic review, including
-- rejected candidates. Retention is not a COMPLETE job or publication approval.
begin;
create table vnext_runtime.ai_stock_model_candidates(
 response_id text primary key check(length(response_id) between 1 and 200),
 job_id text not null references vnext_runtime.ai_stock_jobs(id),
 candidate jsonb not null check(jsonb_typeof(candidate)='object' and octet_length(candidate::text)<=128000),
 candidate_hash text not null check(candidate_hash=encode(sha256(convert_to(candidate::text,'UTF8')),'hex')),
 receipt jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table vnext_runtime.ai_stock_model_candidates enable row level security;
alter table vnext_runtime.ai_stock_model_candidates force row level security;
revoke all on vnext_runtime.ai_stock_model_candidates from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_runtime.ai_stock_model_candidates
 for each row execute function vnext_runtime.immutable();
create function public.retain_daily_ai_model_candidate_v1(p_input_hash text,p_model_revision text,p_symbol text,
 p_cutoff timestamptz,p_candidate jsonb,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j vnext_runtime.ai_stock_jobs;
begin
 select * into strict j from vnext_runtime.ai_stock_jobs where input_hash=p_input_hash
  and model_revision=p_model_revision and symbol=p_symbol and cutoff=p_cutoff and state='RUNNING' and lease_until>clock_timestamp();
 if jsonb_typeof(p_candidate) is distinct from 'object' or octet_length(p_candidate::text)>128000
  or p_candidate->>'symbol' is distinct from p_symbol or jsonb_typeof(p_receipt) is distinct from 'object'
  or length(coalesce(p_receipt->>'response_id','')) not between 1 and 200
  or length(coalesce(p_receipt->>'model','')) not between 1 and 200
  or jsonb_typeof(p_receipt->'input_tokens') is distinct from 'number'
  or jsonb_typeof(p_receipt->'output_tokens') is distinct from 'number'
  or (p_receipt->>'input_tokens')::numeric not between 0 and 1000000
  or (p_receipt->>'output_tokens')::numeric not between 0 and 100000
  or (p_receipt-'response_id'-'model'-'input_tokens'-'output_tokens')<>'{}'::jsonb then raise exception 'AI_CANDIDATE_SCOPE';end if;
 insert into vnext_runtime.ai_stock_model_candidates(response_id,job_id,candidate,candidate_hash,receipt)
 values(p_receipt->>'response_id',j.id,p_candidate,encode(sha256(convert_to(p_candidate::text,'UTF8')),'hex'),p_receipt)
 on conflict do nothing;
 return jsonb_build_object('state','RETAINED','member_published',false);
end $$;
revoke all on function public.retain_daily_ai_model_candidate_v1(text,text,text,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.retain_daily_ai_model_candidate_v1(text,text,text,timestamptz,jsonb,jsonb) to service_role;
commit;
