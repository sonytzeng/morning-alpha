CREATE OR REPLACE FUNCTION vnext_private.ai_use_primary_documents_v1(p_basis text, p_urls text[], p_sources text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(cardinality(p_urls) between 1 and 20
  and (select count(distinct u) from unnest(p_urls)u)=cardinality(p_urls)
  and not exists(select from unnest(p_sources)src where src ~* '^https://([a-z0-9-]+\.)*yahoo[.]com([/:]|$)')
  and not exists(select from unnest(p_urls)u where u is null or length(u) not between 12 and 3000
   or (u<>'https://www.federalreserve.gov/disclaimer.htm' and u !~ '^https://([a-z0-9-]+\.)*(twse\.com\.tw|tpex\.org\.tw|taifex\.com\.tw|treasury\.gov|catalog\.data\.gov|data\.gov\.tw|tipo\.gov\.tw|tsmc\.com|honhai\.com|mediatek\.com|realtek\.com|wistron\.com|esmt\.com\.tw|udngroup\.com|udn\.com|cna\.com\.tw|ltn\.com\.tw)/[^#[:space:]]*$')
   or u ~* '[?&][^=]*(token|secret|key|auth|email)[^=]*=')
  and case p_basis
   when 'FACT_ONLY_OWN_ANALYSIS' then exists(select from unnest(p_urls)u where u in(
    'https://www.tipo.gov.tw/tw/copyright/692-16653.html',
    'https://www.tipo.gov.tw/tw/copyright/774-5043.html',
    'https://www.tipo.gov.tw/tw/copyright/692-13930.html',
    'https://www.tipo.gov.tw/tw/copyright/694-17733.html'))
   when 'OPEN_LICENSE' then ('https://data.gov.tw/license'=any(p_urls)
    and exists(select from unnest(p_urls)u where u ~ '^https://data\.gov\.tw/dataset/[0-9]+$'))
    or ('https://catalog.data.gov/dataset/interest-rate-statistics-daily-treasury-yield-curve-rates'=any(p_urls)
     and 'https://home.treasury.gov/treasury-daily-interest-rate-xml-feed'=any(p_urls))
   when 'EXPLICIT_PERMISSION' then cardinality(p_sources)>0 and not exists(
    select from unnest(p_sources)src where not exists(select from unnest(p_urls)doc where exists(
     select from unnest(array['twse.com.tw','tpex.org.tw','taifex.com.tw','treasury.gov','tsmc.com','honhai.com','mediatek.com','realtek.com',
      'wistron.com','esmt.com.tw','udngroup.com','udn.com','cna.com.tw','ltn.com.tw'])publisher(root)
      where src ~ ('^https://([a-z0-9-]+\.)*'||replace(publisher.root,'.','[.]')||'/')
       and doc ~ ('^https://([a-z0-9-]+\.)*'||replace(publisher.root,'.','[.]')||'/'))))
   else false end,false);
$function$
