-- LOCAL CANDIDATE. Four exact additional official JSON source families.
-- This does not extend the base generic capture allowlist or publish a result.
begin;
do $$begin
 if to_regclass('vnext_market.capture_rows') is null or to_regclass('vnext_market.action_capture_tables') is not null
  or to_regprocedure('public.stage_daily_ai_market_public_capture_v2(text,text,text)') is not null
  then raise exception 'MARKET_PUBLIC_SOURCE_BASELINE';end if;
end $$;
create table vnext_market.action_capture_tables(
 capture_id text primary key references vnext_market.captures(id),source_id text not null,
 source_from date not null,source_through date not null,source_through_observed boolean not null,
 table_hash text not null check(table_hash~'^[a-f0-9]{64}$'),fields_hash text not null check(fields_hash~'^[a-f0-9]{64}$'),
 row_count integer not null check(row_count between 0 and 20000),coverage_kinds jsonb not null,
 check(source_from<=source_through and source_through-source_from<=550)
);
create table vnext_market.action_rows(
 capture_id text not null references vnext_market.action_capture_tables(capture_id),row_index integer not null check(row_index between 0 and 19999),
 symbol text not null check(symbol~'^[0-9A-Z]{4,8}$'),effective_date date not null,
 row_hash text not null check(row_hash~'^[a-f0-9]{64}$'),derived jsonb not null,
 primary key(capture_id,row_index),unique(capture_id,row_hash)
);
create index market_action_symbol_date on vnext_market.action_rows(capture_id,symbol,effective_date,row_index);
alter table vnext_market.action_capture_tables enable row level security;
alter table vnext_market.action_capture_tables force row level security;
alter table vnext_market.action_rows enable row level security;
alter table vnext_market.action_rows force row level security;
revoke all on table vnext_market.action_capture_tables,vnext_market.action_rows from public,anon,authenticated,service_role;
create trigger market_action_table_immutable before update or delete on vnext_market.action_capture_tables for each row execute function vnext_market.immutable();
create trigger market_action_row_immutable before update or delete on vnext_market.action_rows for each row execute function vnext_market.immutable();

create function vnext_market.action_date(value text) returns date language plpgsql immutable set search_path='' as $$
declare parts text[];y integer;m integer;d integer;begin
 if value~'^[0-9]{3}/[0-9]{1,2}/[0-9]{1,2}$' then parts:=string_to_array(value,'/');y:=parts[1]::integer+1911;m:=parts[2]::integer;d:=parts[3]::integer;
 elsif value~'^[0-9]{7}$' then y:=substr(value,1,3)::integer+1911;m:=substr(value,4,2)::integer;d:=substr(value,6,2)::integer;
 elsif value~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then parts:=string_to_array(value,'-');y:=parts[1]::integer;m:=parts[2]::integer;d:=parts[3]::integer;
 elsif value~'^20[0-9]{6}$' then y:=substr(value,1,4)::integer;m:=substr(value,5,2)::integer;d:=substr(value,7,2)::integer;
 else return null;end if;
 return make_date(y,m,d);
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;
create function vnext_market.action_decimal(value text) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;begin
 if value is null or btrim(value)!~'^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:[.][0-9]+)?$' then return null;end if;
 n:=replace(btrim(value),',','')::numeric;if n>9007199254740991 then return null;end if;return n;
end $$;
create function vnext_market.action_detail_number(value text,suffix text) returns numeric language plpgsql immutable set search_path='' as $$
begin
 if value is null or value='NA' or (suffix<>'' and right(value,length(suffix))<>suffix) then return null;end if;
 return vnext_market.action_decimal(case when suffix='' then value else btrim(left(value,length(value)-length(suffix))) end);
end $$;
create function vnext_market.action_html_cells(value text,labels text[]) returns text[] language plpgsql immutable set search_path='' as $$
declare body text;parts text[];ord bigint;found_labels text[]:='{}';cells text[]:='{}';rebuilt text:='';begin
 if value is null or length(value)>8000 or left(value,7)<>'<table>' or right(value,8)<>'</table>' then return null;end if;
 body:=substr(value,8,length(value)-15);
 for parts,ord in select matched,n from regexp_matches(body,'<tr><th>([^<>]*)</th><td>([^<>]*)</td></tr>','g') with ordinality t(matched,n) loop
  found_labels:=array_append(found_labels,parts[1]);cells:=array_append(cells,btrim(replace(regexp_replace(parts[2],'&nbsp;?',' ','g'),'&amp;','&')));
  rebuilt:=rebuilt||'<tr><th>'||parts[1]||'</th><td>'||parts[2]||'</td></tr>';
 end loop;
 if rebuilt is distinct from body or found_labels is distinct from labels then return null;end if;return cells;
end $$;
create function vnext_market.derive_action_row(p_source_id text,p_row jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare symbol text:=btrim(p_row->>1);effective date:=vnext_market.action_date(p_row->>0);kinds text[]:='{}';issues text[]:='{}';
 values numeric[];n integer;rights boolean;label text;details text[];suspension date;reported jsonb;subtype text;
 exchanged numeric;cash numeric;ratio numeric;before_value numeric;after_value numeric;capital boolean;
begin
 if p_source_id='tpex_ex_right' then
  for n in 13..20 loop values:=array_append(values,vnext_market.action_decimal(p_row->>n));end loop;
  if exists(select from unnest(values)x where x is null) then issues:=array_append(issues,'EX_RIGHT_EXPLICIT_NONNEGATIVE_FIELDS_REQUIRED');end if;
  if values[1]>0 then kinds:=array_append(kinds,'CASH_DIVIDEND');end if;
  if values[2]>0 then kinds:=array_append(kinds,'STOCK_DIVIDEND');end if;
  if values[7]>0 or values[8]>0 then kinds:=array_append(kinds,'RIGHTS');end if;
  rights:='STOCK_DIVIDEND'=any(kinds) or 'RIGHTS'=any(kinds);
  label:=case when values[1]>0 and rights then '除權息' when values[1]>0 then '除息' when rights then '除權' else null end;
  if label is null or p_row->>8 is distinct from label then issues:=array_append(issues,'EX_RIGHT_CLASSIFICATION_OR_LABEL_UNRESOLVED');end if;
  if cardinality(kinds)=0 then kinds:=array['UNCLASSIFIED_EX_RIGHT'];end if;
  subtype:='EX_RIGHT_OR_DIVIDEND';
  reported:=jsonb_build_object('label',p_row->>8,'cash_dividend',values[1],'bonus_shares_per_1000',values[2],
   'capital_raise_shares',values[3],'subscription_price',values[4],'public_underwriting_shares',values[5],'employee_shares',values[6],
   'original_shareholder_subscription_shares',values[7],'original_shareholder_subscription_per_1000',values[8],
   'quantities_are_as_reported_not_an_entitlement_ledger',true);
 elsif p_source_id in('tpex_capital_reduction','tpex_par_value_change') then
  capital:=p_source_id='tpex_capital_reduction';
  details:=case when capital then vnext_market.action_html_cells(p_row->>10,array['股票代號/股票名稱:','停止買賣日期:','恢復買賣日期:',
   '每壹仟股換發新股票:','每股退還股款:','現金增資總股數:','現金增資認購價:','現金增資配股率:'])
   else vnext_market.action_html_cells(p_row->>8,array['證券代號/證券名稱:','停止買賣日期:','恢復買賣日期:',
    '變更股票面額換股率:','變更前股票面額:','變更後股票面額:']) end;
  if details is null then issues:=array_append(issues,'RESUMPTION_DETAIL_SCHEMA_REQUIRED');
  else
   suspension:=vnext_market.action_date(details[2]);
   if btrim(split_part(details[1],'/',1)) is distinct from symbol or vnext_market.action_date(details[3]) is distinct from effective
    or suspension is null or suspension>effective then issues:=array_append(issues,'RESUMPTION_DETAIL_IDENTITY_OR_DATE');end if;
  end if;
  if capital then
   exchanged:=vnext_market.action_detail_number(details[4],'股');cash:=vnext_market.action_detail_number(details[5],'元/股');
   if exchanged is null or cash is null then issues:=array_append(issues,'CAPITAL_REDUCTION_EXPLICIT_DETAIL_REQUIRED');end if;
   kinds:=array['CAPITAL_REDUCTION'];subtype:='CAPITAL_REDUCTION';
   reported:=jsonb_build_object('reason',p_row->>9,'replacement_shares_per_1000',exchanged,'cash_return_as_reported',cash,
    'capital_raise_shares_text',details[6],'subscription_price_text',details[7],'capital_raise_ratio_text',details[8],
    'quantities_are_as_reported_not_an_entitlement_ledger',true);
  else
   ratio:=vnext_market.action_decimal(details[4]);before_value:=vnext_market.action_decimal(details[5]);after_value:=vnext_market.action_decimal(details[6]);
   if not coalesce(ratio>0 and before_value>0 and after_value>0,false)
    or abs(ratio*after_value-before_value)>greatest(1,before_value)*0.00000001 then issues:=array_append(issues,'PAR_VALUE_DETAIL_RATIO_UNRESOLVED');end if;
   kinds:=array['SPLIT'];subtype:='PAR_VALUE_CHANGE';
   reported:=jsonb_build_object('exchange_ratio_as_reported',ratio,'par_value_before_as_reported',before_value,'par_value_after_as_reported',after_value,
    'replay_kind_mapping','SPLIT_IS_EVENT_EXCLUSION_CLASS_NOT_AN_APPLIED_ADJUSTMENT','quantities_are_as_reported_not_an_entitlement_ledger',true);
  end if;
 else raise exception 'MARKET_ACTION_SOURCE';end if;
 return jsonb_build_object('symbol',symbol,'effective_date',effective,'kinds',to_jsonb(kinds),'subtype',subtype,
  'suspension_from',suspension,'reported',reported,'issues',to_jsonb(issues));
end $$;

create function public.stage_daily_ai_market_public_capture_v2(p_receipt_text text,p_receipt_hash text,p_body_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;body jsonb;cid text;prior vnext_market.captures;source_id text;parts text[];base_url text;
 source_from date;source_through date;day_value date;expected_fields jsonb;coverage_kinds jsonb;tab jsonb;row_body jsonb;row_ord bigint;derived jsonb;
 at_time timestamptz:=clock_timestamp();is_action boolean;
begin
 if p_receipt_text is null or octet_length(p_receipt_text) not between 2 and 20000 or p_receipt_hash is null
  or p_receipt_hash is distinct from vnext_market.digest(p_receipt_text) or p_body_text is null
  or octet_length(p_body_text) not between 1 and 16000000 then raise exception 'MARKET_PUBLIC_SOURCE_SCOPE';end if;
 r:=p_receipt_text::jsonb;source_id:=r->>'source_id';
 if r->>'schema' is distinct from 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' or r->>'state' is distinct from 'CAPTURED'
  or r->'status' is distinct from '200'::jsonb or r->>'format' is distinct from 'json'
  or r->>'sha256' is distinct from vnext_market.digest(p_body_text) or (r->>'bytes')::integer is distinct from octet_length(p_body_text)
  or jsonb_typeof(r->'started_at') is distinct from 'string' or jsonb_typeof(r->'received_at') is distinct from 'string'
  or not isfinite((r->>'started_at')::timestamptz) or not isfinite((r->>'received_at')::timestamptz)
  or (r->>'started_at')::timestamptz>(r->>'received_at')::timestamptz or (r->>'received_at')::timestamptz>at_time
  then raise exception 'MARKET_PUBLIC_SOURCE_RECEIPT';end if;
 body:=ltrim(p_body_text,chr(65279))::jsonb;
 is_action:=source_id in('tpex_ex_right','tpex_capital_reduction','tpex_par_value_change');
 if is_action then
  base_url:='https://www.tpex.org.tw/www/zh-tw/bulletin/'||case source_id when 'tpex_ex_right' then 'exDailyQ' when 'tpex_capital_reduction' then 'revivt' else 'pvChgRslt' end;
  parts:=regexp_match(r->>'url','[?]startDate=(20[0-9]{2}/[0-9]{2}/[0-9]{2})&endDate=(20[0-9]{2}/[0-9]{2}/[0-9]{2})&response=json$');
  if parts is null or r->>'url' is distinct from base_url||'?startDate='||parts[1]||'&endDate='||parts[2]||'&response=json'
   then raise exception 'MARKET_ACTION_URL';end if;
  source_from:=replace(parts[1],'/','-')::date;source_through:=replace(parts[2],'/','-')::date;
  if source_from>source_through or source_through-source_from>550 then raise exception 'MARKET_ACTION_RANGE';end if;
  if not coalesce(vnext_market.exact(body,array['date','tables','stat']),false) or body->>'stat' is distinct from 'ok'
   or body->>'date' is distinct from to_char(source_from,'YYYYMMDD')||'~'||to_char(source_through,'YYYYMMDD')
   or jsonb_typeof(body->'tables') is distinct from 'array' or jsonb_array_length(body->'tables')<>1 then raise exception 'MARKET_ACTION_RESPONSE';end if;
  tab:=body->'tables'->0;
  if source_id='tpex_ex_right' then
   expected_fields:='["除權息日期","代號","名稱","除權息前收盤價","除權息參考價","權值","息值","權值+息值","權/息","漲停價","跌停價","開始交易基準價","減除股利參考價","現金股利","每仟股無償配股","現金增資股數","現金增資認購價","公開承銷股數","員工認購股數","原股東認購股數","按持股比例仟股認購"]';
   coverage_kinds:='["CASH_DIVIDEND","STOCK_DIVIDEND","RIGHTS"]';
  elsif source_id='tpex_capital_reduction' then
   expected_fields:='["恢復買賣日期","股票代號","名稱","最後交易日之收盤價格","減資恢復買賣開始日參考價格","漲停價格","跌停價格","開始交易基準價","除權參考價","減資原因","詳細資料"]';coverage_kinds:='["CAPITAL_REDUCTION"]';
  else
   expected_fields:='["恢復買賣日期","證券代號","證券名稱","最後交易日之收盤價格","恢復買賣開始參考價","漲停價格","跌停價格","開始交易基準價","詳細資料"]';coverage_kinds:='["SPLIT"]';
  end if;
  if jsonb_typeof(tab) is distinct from 'object' or exists(select from jsonb_object_keys(tab)k where k<>all(array['title','totalCount','fields','data','summary','notes','subtitle']))
   or jsonb_typeof(tab->'title') is distinct from 'string' or (tab ? 'subtitle' and jsonb_typeof(tab->'subtitle') is distinct from 'string')
   or tab->'fields' is distinct from expected_fields or jsonb_typeof(tab->'data') is distinct from 'array'
   or jsonb_array_length(tab->'data')>20000 or jsonb_typeof(tab->'totalCount') is distinct from 'number'
   or (tab->>'totalCount')::integer is distinct from jsonb_array_length(tab->'data')
   or tab->'summary' is distinct from '[]'::jsonb or (tab ? 'notes' and tab->'notes' is distinct from '[]'::jsonb)
   then raise exception 'MARKET_ACTION_TABLE_COMPLETENESS';end if;
 else
  parts:=regexp_match(source_id,'^TWSE_VALUATION_([0-9]{8})$');
  if parts is null or r->>'url' is distinct from 'https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?date='||parts[1]||'&selectType=ALL&response=json'
   then raise exception 'MARKET_PUBLIC_SOURCE_NOT_ALLOWED';end if;
  day_value:=make_date(substr(parts[1],1,4)::integer,substr(parts[1],5,2)::integer,substr(parts[1],7,2)::integer);
  if day_value>((r->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date
   or body->>'stat' is distinct from 'OK' or body->>'date' is distinct from parts[1]
   or body->'fields' is distinct from '["證券代號","證券名稱","收盤價","殖利率(%)","股利年度","本益比","股價淨值比","財報年/季"]'::jsonb
   or jsonb_typeof(body->'data') is distinct from 'array'
   or jsonb_array_length(body->'data')>20000 then raise exception 'MARKET_VALUATION_RESPONSE';end if;
 end if;
 cid:=vnext_market.hash(jsonb_build_object('source_id',source_id,'url',r->>'url','source_sha256',r->>'sha256','received_at',r->>'received_at'));
 perform pg_advisory_xact_lock(hashtextextended('market-public:'||cid,0));
 select * into prior from vnext_market.captures where id=cid;
 if found then
  if prior.body_text is distinct from p_body_text or prior.receipt_hash is distinct from p_receipt_hash then raise exception 'MARKET_PUBLIC_SOURCE_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',true);
 end if;
 insert into vnext_market.captures(id,source_id,source_url,receipt_text,receipt_hash,receipt,body_text,body_sha256,body_bytes,parsed,received_at)
 values(cid,source_id,r->>'url',p_receipt_text,p_receipt_hash,r,p_body_text,r->>'sha256',octet_length(p_body_text),body,(r->>'received_at')::timestamptz);
 if is_action then
  insert into vnext_market.action_capture_tables values(cid,source_id,source_from,source_through,
   (r->>'received_at')::timestamptz>=(source_through::text||'T13:30:00+08:00')::timestamptz,
   vnext_market.hash(tab),vnext_market.hash(tab->'fields'),jsonb_array_length(tab->'data'),coverage_kinds);
  for row_body,row_ord in select x,ord-1 from jsonb_array_elements(tab->'data') with ordinality t(x,ord) loop
   if jsonb_typeof(row_body) is distinct from 'array' or jsonb_array_length(row_body)<>jsonb_array_length(expected_fields)
    or exists(select from jsonb_array_elements(row_body)x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>8000)
    or coalesce(btrim(row_body->>1),'')!~'^[0-9A-Z]{4,8}$' then raise exception 'MARKET_ACTION_ROW';end if;
   derived:=vnext_market.derive_action_row(source_id,row_body);day_value:=(derived->>'effective_date')::date;
   if day_value is null or day_value<source_from or day_value>source_through then raise exception 'MARKET_ACTION_ROW_RANGE';end if;
   insert into vnext_market.capture_rows(capture_id,row_index,row_path,row_hash,row_body)
    values(cid,row_ord::integer,array['tables','0','data',row_ord::text],vnext_market.hash(row_body),row_body);
   insert into vnext_market.action_rows values(cid,row_ord::integer,derived->>'symbol',day_value,vnext_market.hash(row_body),derived);
  end loop;
 else
  for row_body,row_ord in select x,ord-1 from jsonb_array_elements(body->'data') with ordinality t(x,ord) loop
   if jsonb_typeof(row_body) is distinct from 'array' or jsonb_array_length(row_body)<>8
    or exists(select from jsonb_array_elements(row_body) with ordinality t(x,n)
     where (n<>5 and (jsonb_typeof(x)<>'string' or length(x#>>'{}')>8000))
      or (n=5 and (jsonb_typeof(x)<>'number' or (x#>>'{}')!~'^[0-9]{1,3}$')))
    or coalesce(btrim(row_body->>0),'')!~'^[0-9A-Z]{4,8}$' then raise exception 'MARKET_VALUATION_ROW';end if;
   insert into vnext_market.capture_rows(capture_id,row_index,row_path,row_hash,row_body)
    values(cid,row_ord::integer,array['data',row_ord::text],vnext_market.hash(row_body),row_body);
  end loop;
 end if;
 return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',false);
end $$;
revoke all on function vnext_market.action_date(text),vnext_market.action_decimal(text),vnext_market.action_detail_number(text,text),
 vnext_market.action_html_cells(text,text[]),vnext_market.derive_action_row(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_public_capture_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_public_capture_v2(text,text,text) to service_role;
commit;
