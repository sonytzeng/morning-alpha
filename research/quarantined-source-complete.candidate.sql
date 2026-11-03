-- Private research completion only. No source-use approval, model or publication grant.
-- Run after both immutable issuer registries; refuses any deployed trigger drift.
begin;
do $guard$
begin
 if to_regprocedure('vnext_runtime.quarantined_issuer_source_completion_v1(vnext_runtime.ai_stock_intakes)') is not null then
  raise exception 'AI_INTAKE_QUARANTINE_COMPLETE_ALREADY_PRESENT';end if;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('vnext_runtime.seal_daily_stock_ai_intake_v1()')),'UTF8')),'hex')
  is distinct from 'c84cfe775d387f34b575340ce2c7cfbf7dd46c9ebcf3a23aefcb80a001ca74d8' then
  raise exception 'AI_INTAKE_QUARANTINE_COMPLETE_BASELINE_DRIFT';end if;
end $guard$;

create function vnext_runtime.quarantined_issuer_source_completion_v1(p_q vnext_runtime.ai_stock_intakes)
returns boolean language plpgsql stable set search_path='' as $fn$
declare b vnext_runtime.ai_stock_batches;r record;actual jsonb;registered jsonb;expected jsonb;
 all_registered jsonb:='[]';namespace text;proof_key text;proof_schema text;found_registry boolean:=false;
 quarantine constant text:='QUARANTINED_ISSUER_RESEARCH_NOT_LICENSED_FOR_MODEL_OR_MEMBER_USE';
begin
 if p_q.state is distinct from 'COMPLETE' or p_q.batch_id is null or p_q.cutoff is null
  or not isfinite(p_q.cutoff) or jsonb_typeof(p_q.inputs) is distinct from 'array'
  or jsonb_array_length(p_q.inputs)<>72 then return false;end if;
 select * into b from vnext_runtime.ai_stock_batches where id=p_q.batch_id;
 if b.id is null or b.cutoff is distinct from p_q.cutoff
  or jsonb_typeof(b.payload->'packets') is distinct from 'array' or jsonb_array_length(b.payload->'packets')<>72
  or (select count(distinct p->>'symbol') from jsonb_array_elements(b.payload->'packets')p)<>72
  or b.payload->'source_handoff' is not null
  or b.payload->'source_intake' is distinct from jsonb_build_object('intake_id',p_q.id,'snapshot_hash',p_q.snapshot_hash,
    'source_kind',p_q.source_kind,'source_id',p_q.source_id,'source_revision',p_q.source_revision,
    'source_cutoff',p_q.source_cutoff,'source_business_date',p_q.source_business_date,
    'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1')
  or exists(select from jsonb_array_elements(b.payload->'packets')p
   where jsonb_typeof(p->'data_gaps') is distinct from 'array' or not(p->'data_gaps' ? quarantine))
  then return false;end if;
 -- Re-bind the frozen SOURCE bytes, including the full private financial proof.
 if p_q.snapshot_hash is distinct from encode(sha256(convert_to(jsonb_build_object(
  'schema','DAILY_AI_INTAKE_SNAPSHOT_V1','financial_refresh',p_q.financial_refresh,'inputs',p_q.inputs,
  'news',p_q.news,'market',p_q.market,'cutoff',p_q.cutoff_text,'intake_gaps',p_q.intake_gaps,
  'gaps_by_symbol',p_q.gaps_by_symbol,'source_issues',p_q.source_issues,'source_kind',p_q.source_kind,
  'source_id',p_q.source_id,'source_revision',p_q.source_revision,'source_cutoff',p_q.source_cutoff)::text,'UTF8')),'hex')
  then return false;end if;
 for r in select 'issuer-ir-direct:' ns,'issuer_ir_replay' pk,'DAILY_AI_ISSUER_IR_REPLAY_V1' ps,
   source_seal_sha256,facts_sha256,facts_text,ingestion_verified,source_admitted,member_publication_approved
   from vnext_private.verified_issuer_ir_facts_v1
   where source_seal_sha256='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32'
  union all select 'umc-ir-direct:','umc_ir_replay','DAILY_AI_UMC_IR_REPLAY_V1',
   source_seal_sha256,facts_sha256,facts_text,ingestion_verified,source_admitted,member_publication_approved
   from vnext_private.verified_umc_ir_facts_v1
   where source_seal_sha256='fd579e5d06f89ff3e3d84aba9cf532e7839e79b1984841906387cc9b04ac5ccc'
 loop
  select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into actual
   from jsonb_array_elements(p_q.inputs)i,lateral jsonb_array_elements(i->'facts')f where starts_with(f->>'id',r.ns);
  if actual='[]'::jsonb then
   if p_q.financial_refresh ? r.pk then return false;end if;
   continue;
  end if;
  found_registry:=true;
  select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
  if r.ingestion_verified is distinct from true or r.source_admitted is distinct from false
   or r.member_publication_approved is distinct from false
   or encode(sha256(convert_to(r.facts_text,'UTF8')),'hex') is distinct from r.facts_sha256
   or actual is distinct from registered
   or exists(select from jsonb_array_elements(p_q.inputs)i,lateral jsonb_array_elements(i->'facts')f
    where starts_with(f->>'id',r.ns) and i->>'symbol' is distinct from f->>'symbol')
   or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_q.cutoff
    or (f->>'first_seen_at')::timestamptz>p_q.cutoff or (f->>'as_of')::timestamptz>p_q.cutoff)
   then return false;end if;
  expected:=jsonb_build_object('schema',r.ps,'source_seal_sha256',r.source_seal_sha256,
   'facts_sha256',r.facts_sha256,'fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
   'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
  if p_q.financial_refresh->r.pk is distinct from expected then return false;end if;
  all_registered:=all_registered||registered;
 end loop;
 if not found_registry then return false;end if;
 -- Exact issuer observations are the only exception. Unknown observations from
 -- these hosts (including UMC, whose host is not in the old restricted list) fail.
 if exists(select from jsonb_array_elements(p_q.inputs)i,lateral jsonb_array_elements(i->'facts')f
  where (starts_with(f->>'id','issuer-ir-direct:') or starts_with(f->>'id','umc-ir-direct:')
   or vnext_runtime.daily_ai_financial_restricted_v3(f->>'source')
   or f->>'source' ~* '^https?://([^/]*\.)?(mediatek\.com|realtek\.com|umc\.com)([:/]|$)')
  and not exists(select from jsonb_array_elements(all_registered)rf where rf=f and rf->>'symbol'=i->>'symbol'))
  then return false;end if;
 -- Every fixed observation must survive compilation exactly once. No renamed,
 -- truncated or extra issuer evidence is accepted by this private completion.
 if exists(select from jsonb_array_elements(all_registered)f where
   (select count(*) from jsonb_array_elements(b.payload->'packets')p,lateral jsonb_array_elements(p->'evidence')e
    where p->>'symbol'=f->>'symbol' and e->>'kind'='FINANCIAL'
     and e->>'id'=(f->>'symbol')||':FINANCIAL:'||(f->>'id'))<>1)
  or exists(select from jsonb_array_elements(b.payload->'packets')p,lateral jsonb_array_elements(p->'evidence')e
   where e->>'kind'='FINANCIAL' and (e->>'id' like '%:FINANCIAL:issuer-ir-direct:%'
    or e->>'id' like '%:FINANCIAL:umc-ir-direct:%'
    or starts_with((e->>'content')::jsonb->>'original_id','issuer-ir-direct:')
    or starts_with((e->>'content')::jsonb->>'original_id','umc-ir-direct:')
    or vnext_runtime.daily_ai_financial_restricted_v3(e->>'source')
    or e->>'source' ~* '^https?://([^/]*\.)?(mediatek\.com|realtek\.com|umc\.com)([:/]|$)')
   and not exists(select from jsonb_array_elements(p_q.inputs)i,lateral jsonb_array_elements(i->'facts')f,
    lateral jsonb_array_elements(all_registered)rf where i->>'symbol'=p->>'symbol' and f=rf
     and e->>'id'=(f->>'symbol')||':FINANCIAL:'||(f->>'id')
     and vnext_runtime.daily_ai_intake_company_evidence_v1(e,i)))
  then return false;end if;
 return vnext_runtime.validate_daily_ai_intake_batch_evidence_v4(p_q.inputs,p_q.news,p_q.market,
  p_q.intake_gaps,p_q.gaps_by_symbol,b.payload->'packets') is true;
exception when others then return false;
end $fn$;
revoke all on function vnext_runtime.quarantined_issuer_source_completion_v1(vnext_runtime.ai_stock_intakes)
 from public,anon,authenticated,service_role;

do $patch$
declare d text;needle constant text:=$old$ if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE' and exists(
  select from jsonb_array_elements(new.inputs)i,jsonb_array_elements(i->'facts')f
   where vnext_runtime.daily_ai_financial_restricted_v3(f->>'source')) then raise exception 'AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE';end if;$old$;
 replacement constant text:=$new$ if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE' and (
  exists(select from jsonb_array_elements(new.inputs)i,jsonb_array_elements(i->'facts')f
   where vnext_runtime.daily_ai_financial_restricted_v3(f->>'source')
    or starts_with(f->>'id','issuer-ir-direct:') or starts_with(f->>'id','umc-ir-direct:')
    or f->>'source' ~* '^https?://([^/]*\.)?(mediatek\.com|realtek\.com|umc\.com)([:/]|$)')
  or exists(select from vnext_runtime.ai_stock_batches b,lateral jsonb_array_elements(b.payload->'packets')p
   where b.id=new.batch_id and p->'data_gaps' ? 'QUARANTINED_ISSUER_RESEARCH_NOT_LICENSED_FOR_MODEL_OR_MEMBER_USE'))
  and vnext_runtime.quarantined_issuer_source_completion_v1(new) is distinct from true
  then raise exception 'AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE';end if;$new$;
begin
 d:=pg_get_functiondef(to_regprocedure('vnext_runtime.seal_daily_stock_ai_intake_v1()'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from 'c84cfe775d387f34b575340ce2c7cfbf7dd46c9ebcf3a23aefcb80a001ca74d8'
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'AI_INTAKE_QUARANTINE_COMPLETE_CALLSITE_DRIFT';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
