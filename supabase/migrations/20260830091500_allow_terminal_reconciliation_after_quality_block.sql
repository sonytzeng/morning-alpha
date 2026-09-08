begin;

-- Preserve strict classification for genuine HTTP 409 quality failures, while
-- allowing the service-role-only terminal reconciler to supersede a stale
-- transport receipt after every durable Morning Alpha outcome has succeeded.
-- The original HTTP status and response_success value remain immutable audit
-- evidence; only the terminal dispatch classification is reconciled.
create or replace function public.classify_runtime_quality_block_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'postgres'
     and old.dispatch_status = 'FAILED'
     and new.dispatch_status = 'SKIPPED'
     and new.response_error_code = 'SUPERSEDED_BY_DURABLE_STATE'
     and new.response_body #>> '{terminal_reconciliation,reason_code}' = 'SUPERSEDED_BY_DURABLE_STATE'
     and nullif(new.response_body #>> '{terminal_reconciliation,correlation_id}', '') is not null
  then
    return new;
  end if;

  if new.http_status = 409 and coalesce(new.response_success, false) = false then
    new.dispatch_status := 'FAILED';
    new.response_error_code := 'QUALITY_BLOCK';
    new.next_retry_at := null;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

comment on function public.classify_runtime_quality_block_v1() is
  'Fail-closes genuine HTTP 409 receipts while permitting audited, postgres-owned terminal reconciliation after durable success.';

commit;
