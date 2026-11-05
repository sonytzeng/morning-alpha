-- LOCAL CANDIDATE ONLY: exact three SEC primary-policy documents; no source-use grant.
-- Preserves all existing basis, source, Yahoo, URL shape and sensitive-query checks.
-- Forward patch; refuses a missing, altered, differently privileged or already changed helper.
begin;
do $sec_primary_documents$
declare
 v_oid oid := pg_catalog.to_regprocedure('vnext_private.ai_use_primary_documents_v1(text,text[],text[])');
 v_definition text;
 v_old text := $old_predicate$u<>'https://www.federalreserve.gov/disclaimer.htm'$old_predicate$;
 v_new text := $new_predicate$u not in ('https://www.federalreserve.gov/disclaimer.htm',
    'https://www.sec.gov/about/webmaster-frequently-asked-questions',
    'https://www.sec.gov/about/privacy-information',
    'https://www.sec.gov/search-filings/edgar-application-programming-interfaces')$new_predicate$;
begin
 if v_oid is null then raise exception 'SEC_PRIMARY_DOCUMENT_BASELINE_MISSING';end if;
 select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_definition,'UTF8')),'hex')
  is distinct from '615d822ecd384d65e92cc9232a373af3a91610b5fdbd9d52a75236b57a2493a9'
  then raise exception 'SEC_PRIMARY_DOCUMENT_BASELINE_DRIFT';end if;
 if not exists(select from pg_catalog.pg_proc p where p.oid=v_oid
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.provolatile='i' and not p.prosecdef
  and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
  and p.prolang=(select l.oid from pg_catalog.pg_language l where l.lanname='sql'))
  then raise exception 'SEC_PRIMARY_DOCUMENT_PRIVILEGE_DRIFT';end if;
 if (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))
  /pg_catalog.length(v_old)<>1 then raise exception 'SEC_PRIMARY_DOCUMENT_PATCH_NOT_EXACT';end if;
 execute pg_catalog.replace(v_definition,v_old,v_new);
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(v_oid),'UTF8')),'hex')
  is distinct from '93f4623a2f17ad952f049804c2e2b1ca640d712ea7f92a0842aed9292a92737a'
  then raise exception 'SEC_PRIMARY_DOCUMENT_RESULT_DRIFT';end if;
 if not exists(select from pg_catalog.pg_proc p where p.oid=v_oid
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.provolatile='i' and not p.prosecdef
  and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}'
  and p.prolang=(select l.oid from pg_catalog.pg_language l where l.lanname='sql'))
  then raise exception 'SEC_PRIMARY_DOCUMENT_PRIVILEGE_CHANGED';end if;
end
$sec_primary_documents$;
commit;
