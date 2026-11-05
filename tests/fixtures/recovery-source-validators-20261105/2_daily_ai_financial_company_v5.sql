CREATE OR REPLACE FUNCTION vnext_runtime.daily_ai_financial_company_v5(p_old jsonb, p_new jsonb, p_proof jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare audit jsonb;response jsonb;row jsonb;name text;source constant text:='https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O';
begin
 if p_old->>'symbol' is distinct from p_new->>'symbol' then return false;end if;
 if p_old->'company' is not distinct from p_new->'company' then return true;end if;
 if p_old->>'company' is distinct from p_old->>'symbol' or jsonb_typeof(p_proof->'company_names') is distinct from 'array' then return false;end if;
 select x into strict audit from jsonb_array_elements(p_proof->'company_names')x where x->>'symbol'=p_old->>'symbol';
 if jsonb_typeof(audit) is distinct from 'object' or (select count(*) from jsonb_object_keys(audit))<>5
  or audit->>'previous_company' is distinct from p_old->>'company' or audit->>'company' is distinct from p_new->>'company'
  or audit->>'source' is distinct from source or jsonb_typeof(audit->'row_text') is distinct from 'string' or octet_length(audit->>'row_text')>30000 then return false;end if;
 select x into strict response from jsonb_array_elements(p_proof->'responses')x where x->>'source'=source and x->>'state'='CAPTURED';
 if response->>'source_sha256' is distinct from encode(sha256(convert_to(response->>'response_text','UTF8')),'hex')
  or (response->>'source_bytes')::numeric is distinct from octet_length(response->>'response_text')::numeric then return false;end if;
 row:=(audit->>'row_text')::jsonb;name:=row->>'CompanyName';
 if jsonb_typeof(row->'CompanyName') is distinct from 'string' or name is null or name<>btrim(name) or length(name) not between 1 and 100
  or name ~ '[[:cntrl:]]' or name=p_old->>'symbol' or name is distinct from p_new->>'company' or row->>'SecuritiesCompanyCode' is distinct from p_old->>'symbol'
  or row is distinct from vnext_runtime.daily_ai_financial_latest_v5((response->>'response_text')::jsonb,p_old->>'symbol',(response->>'received_at')::timestamptz,source,'EPS_AS_REPORTED')
  or vnext_runtime.daily_ai_financial_body_v3(p_old->>'symbol','EPS_AS_REPORTED',row,response,encode(sha256(convert_to(audit->>'row_text','UTF8')),'hex')) is null then return false;end if;
 if not exists(select from jsonb_array_elements(p_proof->'additions')a where a->>'symbol'=p_old->>'symbol' and a->>'row_text'=audit->>'row_text'
  and (a->>'body_text')::jsonb->>'kind'='EPS_AS_REPORTED' and (a->>'body_text')::jsonb->>'source'=source) then return false;end if;
 return true;
exception when others then return false;
end $function$
