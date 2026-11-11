-- Bounded private company discovery for the existing Owner workbench. No
-- member, review, source-license or publication contract changes.
begin;
do $$begin
 if to_regprocedure('public.get_daily_ai_owner_market_catalog_v2(jsonb,integer)')is null
  or to_regprocedure('public.get_daily_ai_owner_market_search_v2(text,text,integer)')is not null
  then raise exception 'MARKET_OWNER_SEARCH_PREREQUISITES';end if;
end $$;
create function public.get_daily_ai_owner_market_search_v2(p_edition_id text,p_query text,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e vnext_market.editions;normalized_query text;needle text;rows jsonb;more boolean;
begin
 if auth.uid()is null or academy_private.access_v11()is distinct from'owner' or not coalesce(public.is_research_owner_v1(),false)
  then raise exception 'OWNER_REQUIRED'using errcode='42501';end if;
 if coalesce(p_edition_id,'')!~'^[a-f0-9]{64}$'or p_limit is null or p_limit not between 1 and 20
  then raise exception 'MARKET_OWNER_SEARCH_SCOPE';end if;
 normalized_query:=btrim(p_query);
 if normalized_query is null or length(normalized_query)not between 1 and 80 or octet_length(normalized_query)>320
  or normalized_query~'[[:cntrl:]]'
  or exists(select from unnest(array['%','_',chr(92),chr(39),';','"','<','>','`','{','}','|','$','*'])c where strpos(normalized_query,c)>0)
  then raise exception 'MARKET_OWNER_SEARCH_QUERY';end if;
 select * into e from vnext_market.editions where id=p_edition_id;
 if not found then raise exception 'MARKET_OWNER_SEARCH_EDITION';end if;
 needle:=lower(replace(normalized_query,'臺','台'));
 select coalesce(jsonb_agg(jsonb_build_object('security_id',c.security_id,'market',c.market,'symbol',c.symbol,
  'company',c.company,'short_name',coalesce(c.body->>'short_name',c.company))order by c.rank,c.symbol),'[]')into rows
 from(select c.*,case c.market when'TWSE'then 0 when'TPEX'then 1 else 2 end rank
  from vnext_market.companies c where c.universe_id=e.universe_id
   and(strpos(c.symbol,needle)>0 or strpos(lower(replace(c.company,'臺','台')),needle)>0
    or strpos(lower(replace(coalesce(c.body->>'short_name',''),'臺','台')),needle)>0)
   and exists(select from vnext_market.stock_results s where s.plan_id=e.plan_id and s.security_id=c.security_id)
  order by rank,c.symbol limit p_limit+1)c;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;end if;
 return jsonb_build_object('schema','VNEXT_AI_OWNER_MARKET_SEARCH_V2','subject_user_id',auth.uid(),'preview_only',true,'research_only',true,
  'edition_id',e.id,'universe_hash',e.universe_id,'query',normalized_query,'limit',p_limit,'checked_at',vnext_market.iso(now()),
  'companies',rows,'has_more',more);
end $$;
revoke all on function public.get_daily_ai_owner_market_search_v2(text,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_market_search_v2(text,text,integer)to authenticated;
commit;
