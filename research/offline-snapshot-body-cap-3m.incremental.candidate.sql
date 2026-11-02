-- Apply only AFTER stage-only-to-offline-edition af0 upgrade.
-- Capacity only: original body/claim/source/provenance/review/permission gates remain.
begin;
lock table vnext_private.reviewed_analysis_snapshots_v1 in access exclusive mode;
do $capacity$
declare definition text;needle text:='octet_length(p_body_text) not between 2 and 2000000';
begin
 if to_regprocedure('public.stage_offline_reviewed_analysis_edition_v1(text,timestamp with time zone)') is null
  then raise exception 'OFFLINE_CAPACITY_APPLY_AF0_UPGRADE_FIRST';end if;
 select pg_get_functiondef('public.stage_offline_reviewed_analysis_snapshot_v1(text,text,text)'::regprocedure) into definition;
 if encode(sha256(convert_to(definition,'UTF8')),'hex') is distinct from '872d8dee6f639aab6e8919cb8b53f612ee0ae03cfb3b3f4318dbb20a49ae6741'
  or length(definition)-length(replace(definition,needle,''))<>length(needle)
  then raise exception 'OFFLINE_CAPACITY_STAGE_RPC_DRIFT';end if;
 if (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid='vnext_private.reviewed_analysis_snapshots_v1'::regclass and conname='reviewed_analysis_snapshots_v1_body_text_check')
  is distinct from 'CHECK (((octet_length(body_text) >= 2) AND (octet_length(body_text) <= 2000000)))'
  then raise exception 'OFFLINE_CAPACITY_BODY_CONSTRAINT_DRIFT';end if;
 execute replace(definition,needle,'octet_length(p_body_text) not between 2 and 3000000');
end $capacity$;
alter table vnext_private.reviewed_analysis_snapshots_v1 drop constraint reviewed_analysis_snapshots_v1_body_text_check;
alter table vnext_private.reviewed_analysis_snapshots_v1 add constraint reviewed_analysis_snapshots_v1_body_text_check
 check(octet_length(body_text) between 2 and 3000000);
commit;
