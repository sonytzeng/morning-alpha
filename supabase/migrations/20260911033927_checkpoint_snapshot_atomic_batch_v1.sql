-- P0: make every market checkpoint an all-or-nothing, retry-safe 11-row batch.
--
-- Production evidence on and before 2026-09-11 is deliberately left untouched.
-- Existing rows remain immutable legacy evidence and cannot be promoted into an
-- authoritative batch. This migration is authored for review only until the
-- separate Production migration approval is granted.

begin;

do $preflight$
begin
  if to_regclass('public.market_checkpoint_snapshots') is null then
    raise exception 'MARKET_CHECKPOINT_SNAPSHOTS_REQUIRED';
  end if;
  if to_regclass('public.market_data_snapshots') is null then
    raise exception 'MARKET_DATA_SNAPSHOTS_REQUIRED';
  end if;
  if to_regclass('public.trading_day_state') is null then
    raise exception 'TRADING_DAY_STATE_REQUIRED';
  end if;
  if to_regclass('public.production_acceptance_results') is null then
    raise exception 'PRODUCTION_ACCEPTANCE_RESULTS_REQUIRED';
  end if;
end;
$preflight$;

create table if not exists public.market_checkpoint_batches (
  batch_id uuid primary key default gen_random_uuid(),
  business_date date not null,
  checkpoint text not null,
  market_session text not null,
  correlation_id uuid not null,
  idempotency_key text not null,
  provider_contract_version text not null,
  status text not null,
  expected_provider_count smallint not null,
  committed_provider_count smallint not null,
  payload_hash text not null,
  committed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint market_checkpoint_batches_cutover_check
    check (business_date > date '2026-09-11'),
  constraint market_checkpoint_batches_checkpoint_check
    check (checkpoint in ('PREMARKET','0900','0930','1030','1300','1410','1430','RECOVERY')),
  constraint market_checkpoint_batches_session_check
    check (market_session in ('premarket','intraday','close','recovery')),
  constraint market_checkpoint_batches_status_check
    check (status = 'COMMITTED'),
  constraint market_checkpoint_batches_contract_check
    check (provider_contract_version = 'MARKET_CHECKPOINT_PROVIDER_V1'),
  constraint market_checkpoint_batches_counts_check
    check (expected_provider_count = 11 and committed_provider_count = 11),
  constraint market_checkpoint_batches_idempotency_key_key unique (idempotency_key),
  constraint market_checkpoint_batches_business_checkpoint_key unique (business_date, checkpoint)
);

alter table public.market_checkpoint_batches enable row level security;
alter table public.market_checkpoint_batches force row level security;
revoke all on table public.market_checkpoint_batches from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.market_checkpoint_batches from service_role;
grant select, insert on table public.market_checkpoint_batches to service_role;

alter table public.market_checkpoint_snapshots
  add column if not exists batch_id uuid,
  add column if not exists provider_key text,
  add column if not exists idempotency_key text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_checkpoint_snapshots'::regclass
      and conname = 'market_checkpoint_snapshots_batch_id_fkey'
  ) then
    alter table public.market_checkpoint_snapshots
      add constraint market_checkpoint_snapshots_batch_id_fkey
      foreign key (batch_id) references public.market_checkpoint_batches(batch_id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_checkpoint_snapshots'::regclass
      and conname = 'market_checkpoint_snapshots_atomic_identity_check'
  ) then
    alter table public.market_checkpoint_snapshots
      add constraint market_checkpoint_snapshots_atomic_identity_check check (
        (batch_id is null and provider_key is null and idempotency_key is null)
        or
        (batch_id is not null and provider_key is not null and idempotency_key is not null
          and provider_key in ('SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y','TAIEX','2330','TXF'))
      ) not valid;
  end if;
end;
$constraints$;

create unique index if not exists market_checkpoint_snapshots_batch_provider_uidx
  on public.market_checkpoint_snapshots(batch_id, provider_key)
  where batch_id is not null;

create unique index if not exists market_checkpoint_snapshots_authoritative_provider_uidx
  on public.market_checkpoint_snapshots(trading_date, checkpoint, provider_key)
  where batch_id is not null;

create index if not exists market_checkpoint_snapshots_batch_lookup_idx
  on public.market_checkpoint_snapshots(batch_id, snapshot_version);

create index if not exists market_data_snapshots_atomic_batch_lookup_idx
  on public.market_data_snapshots((raw->>'checkpoint_batch_id'), symbol)
  where raw->>'checkpoint_batch_id' is not null;

-- Production does not have a legacy four-column unique constraint on this
-- compatibility table. Scope the new identity to atomic rows only so historical
-- duplicates remain untouched while ON CONFLICT has a real arbiter.
create unique index if not exists market_data_snapshots_atomic_identity_uidx
  on public.market_data_snapshots(symbol, trading_date, phase, checkpoint)
  where raw->>'checkpoint_batch_id' is not null;

create or replace function public.market_checkpoint_provider_contract_v1()
returns text[]
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
  select array['SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y','TAIEX','2330','TXF']::text[];
$function$;

revoke all on function public.market_checkpoint_provider_contract_v1()
  from public, anon, authenticated;
grant execute on function public.market_checkpoint_provider_contract_v1()
  to service_role;

create or replace function public.market_checkpoint_batch_integrity_v1(
  p_business_date date,
  p_checkpoint text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_total_rows bigint;
  v_unbatched_rows bigint;
  v_batch_count bigint;
  v_distinct_batch_ids bigint;
  v_provider_count bigint;
  v_duplicate_providers bigint;
  v_payload_revisions bigint;
  v_compatibility_rows bigint;
  v_compatibility_provider_count bigint;
  v_compatibility_mismatches bigint;
  v_batch public.market_checkpoint_batches;
  v_status text;
begin
  if p_business_date is null or nullif(btrim(p_checkpoint), '') is null then
    raise exception 'CHECKPOINT_INTEGRITY_IDENTITY_REQUIRED';
  end if;

  select count(*),
         count(*) filter (where batch_id is null),
         count(distinct batch_id),
         count(distinct provider_key) filter (where batch_id is not null),
         count(distinct coalesce(batch_id::text, correlation_id::text))
    into v_total_rows, v_unbatched_rows, v_distinct_batch_ids, v_provider_count, v_payload_revisions
  from public.market_checkpoint_snapshots
  where trading_date = p_business_date and checkpoint = p_checkpoint;

  select count(*) into v_duplicate_providers
  from (
    select provider_key
    from public.market_checkpoint_snapshots
    where trading_date = p_business_date and checkpoint = p_checkpoint and batch_id is not null
    group by provider_key
    having count(*) > 1
  ) duplicates;

  select count(*) into v_batch_count
  from public.market_checkpoint_batches
  where business_date = p_business_date and checkpoint = p_checkpoint and status = 'COMMITTED';

  select * into v_batch
  from public.market_checkpoint_batches
  where business_date = p_business_date and checkpoint = p_checkpoint and status = 'COMMITTED'
  order by committed_at, batch_id
  limit 1;

  select count(*), count(distinct compatibility.symbol)
    into v_compatibility_rows, v_compatibility_provider_count
  from public.market_data_snapshots compatibility
  where compatibility.raw->>'checkpoint_batch_id' = v_batch.batch_id::text;

  select count(*) into v_compatibility_mismatches
  from public.market_checkpoint_snapshots snapshot_row
  left join public.market_data_snapshots compatibility
    on compatibility.raw->>'checkpoint_batch_id' = snapshot_row.batch_id::text
   and compatibility.symbol = snapshot_row.provider_key
  where snapshot_row.batch_id = v_batch.batch_id
    and (
      compatibility.id is null
      or compatibility.trading_date is distinct from snapshot_row.trading_date
      or compatibility.checkpoint is distinct from case
        when snapshot_row.checkpoint = 'PREMARKET' then 'premarket'
        when snapshot_row.checkpoint = 'RECOVERY' then 'manual'
        else snapshot_row.checkpoint
      end
      or compatibility.phase is distinct from case
        when snapshot_row.market_session = 'recovery' then 'manual_backfill'
        else snapshot_row.market_session
      end
      or compatibility.value is distinct from snapshot_row.value
      or compatibility.change_percent is distinct from snapshot_row.change_percent
      or compatibility.source is distinct from snapshot_row.source
      or compatibility.captured_at is distinct from snapshot_row.source_timestamp
      or compatibility.raw->>'correlation_id' is distinct from snapshot_row.correlation_id::text
      or compatibility.raw->>'immutable_snapshot_version' is distinct from snapshot_row.snapshot_version::text
      or compatibility.raw->>'immutable_checkpoint' is distinct from snapshot_row.checkpoint
      or compatibility.raw->>'checkpoint_idempotency_key' is distinct from snapshot_row.idempotency_key
    );

  v_status := case
    when v_total_rows = 0 and v_batch_count = 0 then 'MISSING'
    when v_batch_count = 1
      and v_total_rows = 11
      and v_unbatched_rows = 0
      and v_distinct_batch_ids = 1
      and v_provider_count = 11
      and v_duplicate_providers = 0
      and v_compatibility_rows = 11
      and v_compatibility_provider_count = 11
      and v_compatibility_mismatches = 0
      and v_batch.expected_provider_count = 11
      and v_batch.committed_provider_count = 11
      and v_batch.provider_contract_version = 'MARKET_CHECKPOINT_PROVIDER_V1'
      and not exists (
        select expected.provider_key
        from unnest(public.market_checkpoint_provider_contract_v1()) expected(provider_key)
        except
        select provider_key
        from public.market_checkpoint_snapshots
        where batch_id = v_batch.batch_id
      )
      and not exists (
        select provider_key
        from public.market_checkpoint_snapshots
        where batch_id = v_batch.batch_id
        except
        select expected.provider_key
        from unnest(public.market_checkpoint_provider_contract_v1()) expected(provider_key)
      )
      then 'PASS'
    else 'FAIL'
  end;

  return jsonb_build_object(
    'contract', 'MARKET_CHECKPOINT_ATOMICITY_V1',
    'status', v_status,
    'business_date', p_business_date,
    'checkpoint', p_checkpoint,
    'canonical_row_count', v_total_rows,
    'unbatched_row_count', v_unbatched_rows,
    'committed_batch_count', v_batch_count,
    'distinct_batch_id_count', v_distinct_batch_ids,
    'distinct_provider_count', v_provider_count,
    'duplicate_authoritative_provider_count', v_duplicate_providers,
    'compatibility_row_count', v_compatibility_rows,
    'compatibility_provider_count', v_compatibility_provider_count,
    'compatibility_mismatch_count', v_compatibility_mismatches,
    'mixed_batch_revision_count', greatest(v_payload_revisions - 1, 0),
    'batch_id', v_batch.batch_id,
    'correlation_id', v_batch.correlation_id,
    'idempotency_key', v_batch.idempotency_key,
    'payload_hash', v_batch.payload_hash,
    'production_2026_09_11_evidence_preserved', p_business_date <> date '2026-09-11' or v_unbatched_rows = v_total_rows
  );
end;
$function$;

revoke all on function public.market_checkpoint_batch_integrity_v1(date, text)
  from public, anon, authenticated;
grant execute on function public.market_checkpoint_batch_integrity_v1(date, text)
  to service_role;

create or replace function public.enforce_market_checkpoint_snapshot_batch_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_batch public.market_checkpoint_batches;
begin
  -- The pre-cutover corpus remains byte-for-byte legacy evidence. Once this
  -- guard exists, 2026-09-11 can no longer accumulate another retry fragment.
  if new.trading_date < date '2026-09-11' then
    return new;
  end if;
  if new.batch_id is null or new.provider_key is null or new.idempotency_key is null then
    raise exception 'ATOMIC_CHECKPOINT_DIRECT_INSERT_REJECTED:%:%', new.trading_date, new.checkpoint;
  end if;

  select * into v_batch
  from public.market_checkpoint_batches
  where batch_id = new.batch_id;
  if not found
    or v_batch.business_date is distinct from new.trading_date
    or v_batch.checkpoint is distinct from new.checkpoint
    or v_batch.market_session is distinct from new.market_session
    or v_batch.correlation_id is distinct from new.correlation_id
    or v_batch.idempotency_key is distinct from new.idempotency_key
    or new.provider_key is distinct from new.symbol
    or not (new.provider_key = any(public.market_checkpoint_provider_contract_v1())) then
    raise exception 'ATOMIC_CHECKPOINT_BATCH_IDENTITY_MISMATCH';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_market_checkpoint_snapshot_batch_v1()
  from public, anon, authenticated;

drop trigger if exists enforce_market_checkpoint_snapshot_batch on public.market_checkpoint_snapshots;
create trigger enforce_market_checkpoint_snapshot_batch
before insert on public.market_checkpoint_snapshots
for each row execute function public.enforce_market_checkpoint_snapshot_batch_v1();

create or replace function public.commit_market_checkpoint_batch_v1(
  p_business_date date,
  p_checkpoint text,
  p_market_session text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_rows jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_expected constant text[] := public.market_checkpoint_provider_contract_v1();
  v_contract constant text := 'MARKET_CHECKPOINT_PROVIDER_V1';
  v_expected_key text;
  v_expected_session text;
  v_compatibility_phase text;
  v_compatibility_checkpoint text;
  v_batch_id uuid;
  v_existing public.market_checkpoint_batches;
  v_payload_hash text;
  v_rows jsonb;
  v_integrity jsonb;
  v_count integer;
  v_distinct_count integer;
  v_inserted integer;
begin
  if p_business_date is null or p_business_date <= date '2026-09-11' then
    raise exception 'ATOMIC_CHECKPOINT_CUTOVER_REJECTED:%', p_business_date;
  end if;
  if p_checkpoint not in ('PREMARKET','0900','0930','1030','1300','1410','1430','RECOVERY') then
    raise exception 'INVALID_ATOMIC_CHECKPOINT:%', p_checkpoint;
  end if;
  if p_correlation_id is null then
    raise exception 'ATOMIC_CHECKPOINT_CORRELATION_REQUIRED';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'ATOMIC_CHECKPOINT_ROWS_ARRAY_REQUIRED';
  end if;

  v_expected_session := case
    when p_checkpoint = 'PREMARKET' then 'premarket'
    when p_checkpoint in ('0900','0930','1030','1300') then 'intraday'
    when p_checkpoint in ('1410','1430') then 'close'
    when p_checkpoint = 'RECOVERY' then 'recovery'
  end;
  if p_market_session is distinct from v_expected_session then
    raise exception 'ATOMIC_CHECKPOINT_SESSION_MISMATCH:%:%', p_checkpoint, p_market_session;
  end if;

  v_expected_key := 'market-checkpoint:' || p_business_date::text || ':' || p_checkpoint || ':' || v_contract;
  if p_idempotency_key is distinct from v_expected_key then
    raise exception 'ATOMIC_CHECKPOINT_IDEMPOTENCY_MISMATCH';
  end if;

  select count(*), count(distinct row_value->>'provider_key')
    into v_count, v_distinct_count
  from jsonb_array_elements(p_rows) row_value;
  if v_count <> cardinality(v_expected) or v_distinct_count <> cardinality(v_expected) then
    raise exception 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY:%:%', v_count, v_distinct_count;
  end if;
  if exists (
    select expected.provider_key
    from unnest(v_expected) expected(provider_key)
    except
    select row_value->>'provider_key' from jsonb_array_elements(p_rows) row_value
  ) or exists (
    select row_value->>'provider_key' from jsonb_array_elements(p_rows) row_value
    except
    select expected.provider_key from unnest(v_expected) expected(provider_key)
  ) then
    raise exception 'ATOMIC_CHECKPOINT_PROVIDER_SET_MISMATCH';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    where jsonb_typeof(row_value) is distinct from 'object'
      or row_value->>'provider_key' is distinct from row_value->>'symbol'
      or jsonb_typeof(row_value->'value') is distinct from 'number'
      or (row_value->>'value')::numeric <= 0
      or jsonb_typeof(row_value->'change_percent') is distinct from 'number'
      or jsonb_typeof(row_value->'raw') is distinct from 'object'
      or jsonb_typeof(row_value->'raw'->'change') is distinct from 'number'
      or row_value->'raw'->>'contract' is distinct from 'FETCH_CHECKPOINT_EVIDENCE_V1'
      or coalesce(row_value->'raw'->>'market', '') not in ('TW','US')
      or coalesce(row_value->'raw'->>'freshness_status', '') not in ('fresh','provider_returned')
      or jsonb_typeof(row_value->'raw'->'freshness_age_minutes') is distinct from 'number'
      or coalesce(row_value->'raw'->>'captured_session_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or nullif(btrim(row_value->>'source'), '') is null
      or length(btrim(row_value->>'source')) > 120
      or nullif(row_value->>'captured_at', '') is null
      or nullif(row_value->>'source_timestamp', '') is null
      or ((row_value->>'captured_at')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date
      or (row_value->>'source_timestamp')::timestamptz > (row_value->>'captured_at')::timestamptz + interval '60 seconds'
      or (row_value->>'source_timestamp')::timestamptz < (row_value->>'captured_at')::timestamptz - interval '7 days'
      or (row_value->'raw'->>'market' = 'TW'
        and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
  ) then
    raise exception 'ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) row_value
    where case p_checkpoint
      when 'PREMARKET' then (row_value->>'captured_at')::timestamptz > (p_business_date::text || 'T07:35:00+08:00')::timestamptz
      when '0900' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T09:00:00+08:00')::timestamptz and (p_business_date::text || 'T09:14:59.999999+08:00')::timestamptz
      when '0930' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T09:25:00+08:00')::timestamptz and (p_business_date::text || 'T09:44:59.999999+08:00')::timestamptz
      when '1030' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T10:25:00+08:00')::timestamptz and (p_business_date::text || 'T10:44:59.999999+08:00')::timestamptz
      when '1300' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T12:55:00+08:00')::timestamptz and (p_business_date::text || 'T13:14:59.999999+08:00')::timestamptz
      when '1410' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T14:10:00+08:00')::timestamptz and (p_business_date::text || 'T14:24:59.999999+08:00')::timestamptz
      when '1430' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T14:30:00+08:00')::timestamptz and (p_business_date::text || 'T14:44:59.999999+08:00')::timestamptz
      else false
    end
  ) then
    raise exception 'ATOMIC_CHECKPOINT_COLLECTION_TIME_INVALID';
  end if;

  select md5(jsonb_agg(
    jsonb_build_object(
      'provider_key', row_value->>'provider_key',
      'symbol', row_value->>'symbol',
      'value', row_value->'value',
      'change_percent', row_value->'change_percent',
      'source', row_value->>'source',
      'source_timestamp', row_value->>'source_timestamp',
      'captured_at', row_value->>'captured_at',
      'raw', row_value->'raw'
    ) order by row_value->>'provider_key'
  )::text) into v_payload_hash
  from jsonb_array_elements(p_rows) row_value;

  perform pg_advisory_xact_lock(hashtextextended(
    'market-checkpoint-atomic:' || p_business_date::text || ':' || p_checkpoint, 0
  ));

  if exists (
    select 1 from public.market_checkpoint_snapshots
    where trading_date = p_business_date and checkpoint = p_checkpoint and batch_id is null
  ) then
    raise exception 'LEGACY_CHECKPOINT_EVIDENCE_EXISTS:%:%', p_business_date, p_checkpoint;
  end if;

  select * into v_existing
  from public.market_checkpoint_batches
  where business_date = p_business_date and checkpoint = p_checkpoint;
  if found then
    v_integrity := public.market_checkpoint_batch_integrity_v1(p_business_date, p_checkpoint);
    if v_integrity->>'status' is distinct from 'PASS' then
      raise exception 'EXISTING_ATOMIC_CHECKPOINT_INTEGRITY_VIOLATION';
    end if;
    select jsonb_agg(to_jsonb(snapshot_row) order by array_position(v_expected, snapshot_row.provider_key))
      into v_rows
    from public.market_checkpoint_snapshots snapshot_row
    where snapshot_row.batch_id = v_existing.batch_id;
    return jsonb_build_object(
      'contract', 'MARKET_CHECKPOINT_ATOMIC_COMMIT_V1',
      'status', 'COMMITTED',
      'reused', true,
      'payload_matches', v_existing.payload_hash = v_payload_hash,
      'batch_id', v_existing.batch_id,
      'correlation_id', v_existing.correlation_id,
      'idempotency_key', v_existing.idempotency_key,
      'provider_contract_version', v_existing.provider_contract_version,
      'row_count', jsonb_array_length(v_rows),
      'rows', v_rows
    );
  end if;

  v_batch_id := gen_random_uuid();
  insert into public.market_checkpoint_batches(
    batch_id, business_date, checkpoint, market_session, correlation_id,
    idempotency_key, provider_contract_version, status,
    expected_provider_count, committed_provider_count, payload_hash
  ) values (
    v_batch_id, p_business_date, p_checkpoint, p_market_session, p_correlation_id,
    p_idempotency_key, v_contract, 'COMMITTED', 11, 11, v_payload_hash
  );

  insert into public.market_checkpoint_snapshots(
    checkpoint, trading_date, captured_at, market_session, symbol, value,
    change_percent, source, source_timestamp, correlation_id, raw,
    batch_id, provider_key, idempotency_key
  )
  select
    p_checkpoint,
    p_business_date,
    (row_value->>'captured_at')::timestamptz,
    p_market_session,
    row_value->>'symbol',
    (row_value->>'value')::numeric,
    (row_value->>'change_percent')::numeric,
    row_value->>'source',
    (row_value->>'source_timestamp')::timestamptz,
    p_correlation_id,
    row_value->'raw',
    v_batch_id,
    row_value->>'provider_key',
    p_idempotency_key
  from jsonb_array_elements(p_rows) row_value
  order by array_position(v_expected, row_value->>'provider_key');
  get diagnostics v_inserted = row_count;
  if v_inserted <> 11 then
    raise exception 'ATOMIC_CHECKPOINT_INSERT_COUNT:%', v_inserted;
  end if;

  v_compatibility_phase := case p_market_session when 'recovery' then 'manual_backfill' else p_market_session end;
  v_compatibility_checkpoint := case p_checkpoint
    when 'PREMARKET' then 'premarket'
    when 'RECOVERY' then 'manual'
    else p_checkpoint
  end;

  insert into public.market_data_snapshots(
    symbol, name, market, value, change_percent, captured_at, source,
    phase, trading_date, raw, checkpoint
  )
  select
    snapshot_row.symbol,
    snapshot_row.raw->>'name',
    snapshot_row.raw->>'market',
    snapshot_row.value,
    snapshot_row.change_percent,
    snapshot_row.source_timestamp,
    snapshot_row.source,
    v_compatibility_phase,
    p_business_date,
    jsonb_build_object(
      'provider', snapshot_row.source,
      'source_symbol', snapshot_row.raw->>'source_symbol',
      'display_symbol', snapshot_row.symbol,
      'requested_at', snapshot_row.captured_at,
      'returned_date', snapshot_row.source_timestamp,
      'freshness_status', coalesce(snapshot_row.raw->>'freshness_status', 'provider_returned'),
      'freshness_age_minutes', snapshot_row.raw->'freshness_age_minutes',
      'captured_session_date', snapshot_row.raw->>'captured_session_date',
      'fallback_used', coalesce((snapshot_row.raw->>'fallback_used')::boolean, false),
      'source_raw', coalesce(snapshot_row.raw->'source_raw', '{}'::jsonb),
      'quote', jsonb_build_object(
        'current', snapshot_row.value,
        'change', snapshot_row.raw->'change',
        'change_percent', snapshot_row.change_percent
      ),
      'request_id', left(p_correlation_id::text, 8),
      'correlation_id', p_correlation_id,
      'immutable_snapshot_version', snapshot_row.snapshot_version,
      'immutable_checkpoint', p_checkpoint,
      'checkpoint_batch_id', v_batch_id,
      'checkpoint_idempotency_key', p_idempotency_key,
      'checkpoint_contract_version', v_contract,
      'checkpoint', v_compatibility_checkpoint
    ),
    v_compatibility_checkpoint
  from public.market_checkpoint_snapshots snapshot_row
  where snapshot_row.batch_id = v_batch_id
  order by array_position(v_expected, snapshot_row.provider_key)
  on conflict (symbol, trading_date, phase, checkpoint)
    where raw->>'checkpoint_batch_id' is not null
    do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 11 then
    raise exception 'ATOMIC_CHECKPOINT_COMPATIBILITY_CONFLICT:%', v_inserted;
  end if;

  v_integrity := public.market_checkpoint_batch_integrity_v1(p_business_date, p_checkpoint);
  if v_integrity->>'status' is distinct from 'PASS' then
    raise exception 'ATOMIC_CHECKPOINT_POST_INSERT_INTEGRITY_VIOLATION:%', v_integrity;
  end if;

  select jsonb_agg(to_jsonb(snapshot_row) order by array_position(v_expected, snapshot_row.provider_key))
    into v_rows
  from public.market_checkpoint_snapshots snapshot_row
  where snapshot_row.batch_id = v_batch_id;

  return jsonb_build_object(
    'contract', 'MARKET_CHECKPOINT_ATOMIC_COMMIT_V1',
    'status', 'COMMITTED',
    'reused', false,
    'payload_matches', true,
    'batch_id', v_batch_id,
    'correlation_id', p_correlation_id,
    'idempotency_key', p_idempotency_key,
    'provider_contract_version', v_contract,
    'row_count', jsonb_array_length(v_rows),
    'rows', v_rows
  );
end;
$function$;

revoke all on function public.commit_market_checkpoint_batch_v1(date, text, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_market_checkpoint_batch_v1(date, text, text, uuid, text, jsonb)
  to service_role;

create or replace function public.enforce_market_checkpoint_batch_complete_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_integrity jsonb;
begin
  v_integrity := public.market_checkpoint_batch_integrity_v1(new.business_date, new.checkpoint);
  if v_integrity->>'status' is distinct from 'PASS' then
    raise exception 'ATOMIC_CHECKPOINT_DEFERRED_INTEGRITY_VIOLATION:%', v_integrity;
  end if;
  return null;
end;
$function$;

revoke all on function public.enforce_market_checkpoint_batch_complete_v1()
  from public, anon, authenticated;

drop trigger if exists enforce_market_checkpoint_batch_complete on public.market_checkpoint_batches;
create constraint trigger enforce_market_checkpoint_batch_complete
after insert on public.market_checkpoint_batches
deferrable initially deferred
for each row execute function public.enforce_market_checkpoint_batch_complete_v1();

create or replace function public.reject_market_checkpoint_batch_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'market_checkpoint_batch_is_immutable';
end;
$function$;

revoke all on function public.reject_market_checkpoint_batch_mutation_v1()
  from public, anon, authenticated;

drop trigger if exists reject_market_checkpoint_batch_mutation on public.market_checkpoint_batches;
create trigger reject_market_checkpoint_batch_mutation
before update or delete on public.market_checkpoint_batches
for each row execute function public.reject_market_checkpoint_batch_mutation_v1();

create or replace view public.authoritative_market_data_snapshots_v1
with (security_invoker = true)
as
select
  compatibility.id,
  compatibility.symbol,
  compatibility.name,
  compatibility.market,
  compatibility.value,
  compatibility.change_percent,
  compatibility.captured_at,
  compatibility.source,
  compatibility.phase,
  compatibility.trading_date,
  compatibility.raw,
  compatibility.created_at,
  compatibility.checkpoint,
  batch.batch_id,
  batch.correlation_id as batch_correlation_id,
  batch.idempotency_key as batch_idempotency_key,
  batch.provider_contract_version,
  batch.committed_at
from public.market_data_snapshots compatibility
join public.market_checkpoint_batches batch
  on compatibility.raw->>'checkpoint_batch_id' = batch.batch_id::text
join public.trading_day_state day_state
  on day_state.trading_date = batch.business_date
cross join lateral public.market_checkpoint_batch_integrity_v1(batch.business_date, batch.checkpoint) integrity
where batch.status = 'COMMITTED'
  and integrity->>'status' = 'PASS'
  and day_state.checkpoint_status#>>array[
    case batch.checkpoint when 'PREMARKET' then 'premarket' when 'RECOVERY' then 'manual' else batch.checkpoint end,
    'status'
  ] = 'SUCCEEDED'
  and day_state.checkpoint_status#>>array[
    case batch.checkpoint when 'PREMARKET' then 'premarket' when 'RECOVERY' then 'manual' else batch.checkpoint end,
    'correlation_id'
  ] = batch.correlation_id::text
  and day_state.checkpoint_status#>>array[
    case batch.checkpoint when 'PREMARKET' then 'premarket' when 'RECOVERY' then 'manual' else batch.checkpoint end,
    'metadata', 'atomic_batch_id'
  ] = batch.batch_id::text
  and day_state.checkpoint_status#>array[
    case batch.checkpoint when 'PREMARKET' then 'premarket' when 'RECOVERY' then 'manual' else batch.checkpoint end,
    'metadata', 'atomic_checkpoint_complete'
  ] = 'true'::jsonb
union all
-- Preserve read compatibility for evidence created before the P0 cutover.
-- The 2026-09-11 incident date is intentionally excluded and can never be
-- relabelled as an authoritative legacy result.
select
  compatibility.id,
  compatibility.symbol,
  compatibility.name,
  compatibility.market,
  compatibility.value,
  compatibility.change_percent,
  compatibility.captured_at,
  compatibility.source,
  compatibility.phase,
  compatibility.trading_date,
  compatibility.raw,
  compatibility.created_at,
  compatibility.checkpoint,
  null::uuid as batch_id,
  null::uuid as batch_correlation_id,
  null::text as batch_idempotency_key,
  'LEGACY_PRE_ATOMIC_CUTOVER'::text as provider_contract_version,
  compatibility.created_at as committed_at
from public.market_data_snapshots compatibility
where compatibility.trading_date < date '2026-09-11';

revoke all on table public.authoritative_market_data_snapshots_v1 from public, anon, authenticated;
grant select on table public.authoritative_market_data_snapshots_v1 to service_role;

create or replace function public.read_committed_market_checkpoint_batch_v1(
  p_business_date date,
  p_checkpoint text
)
returns setof public.market_checkpoint_snapshots
language sql
stable
security invoker
set search_path = ''
as $function$
  select snapshot_row.*
  from public.market_checkpoint_snapshots snapshot_row
  join public.market_checkpoint_batches batch on batch.batch_id = snapshot_row.batch_id
  where batch.business_date = p_business_date
    and batch.checkpoint = p_checkpoint
    and batch.status = 'COMMITTED'
    and public.market_checkpoint_batch_integrity_v1(p_business_date, p_checkpoint)->>'status' = 'PASS'
  order by array_position(public.market_checkpoint_provider_contract_v1(), snapshot_row.provider_key);
$function$;

revoke all on function public.read_committed_market_checkpoint_batch_v1(date, text)
  from public, anon, authenticated;
grant execute on function public.read_committed_market_checkpoint_batch_v1(date, text)
  to service_role;

create or replace function public.enforce_atomic_checkpoint_acceptance_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_checkpoint text;
  v_due_at timestamptz;
  v_integrity jsonb;
  v_integrity_map jsonb := '{}'::jsonb;
  v_authoritative_rows bigint;
  v_blocker text;
begin
  if new.business_date < date '2026-09-11' then
    return new;
  end if;

  foreach v_checkpoint in array array['0900','0930','1030','1300','1410','1430'] loop
    v_due_at := (new.business_date::text || 'T' || substr(v_checkpoint,1,2) || ':' || substr(v_checkpoint,3,2) || ':00+08:00')::timestamptz
      + interval '5 minutes';
    if clock_timestamp() < v_due_at then
      continue;
    end if;

    v_integrity := public.market_checkpoint_batch_integrity_v1(new.business_date, v_checkpoint);
    select count(*) into v_authoritative_rows
    from public.authoritative_market_data_snapshots_v1 authoritative
    where authoritative.trading_date = new.business_date
      and authoritative.checkpoint = v_checkpoint;
    v_integrity := v_integrity || jsonb_build_object(
      'authoritative_row_count', v_authoritative_rows,
      'authoritative', v_authoritative_rows = 11
    );
    v_integrity_map := v_integrity_map || jsonb_build_object(v_checkpoint, v_integrity);
    if v_integrity->>'status' is distinct from 'PASS' or v_authoritative_rows <> 11 then
      v_blocker := case
        when v_integrity->>'status' is distinct from 'PASS'
          and coalesce((v_integrity->>'canonical_row_count')::bigint, 0) > 0
          then 'CHECKPOINT_' || v_checkpoint || '_INTEGRITY_VIOLATION'
        when v_integrity->>'status' is distinct from 'PASS'
          then 'CHECKPOINT_' || v_checkpoint || '_ATOMIC_BATCH_MISSING'
        else 'CHECKPOINT_' || v_checkpoint || '_NOT_AUTHORITATIVE'
      end;
      if not (v_blocker = any(coalesce(new.blocking_checks, '{}'::text[]))) then
        new.blocking_checks := array_append(coalesce(new.blocking_checks, '{}'::text[]), v_blocker);
      end if;
      new.verdict := 'FAIL';
    end if;
  end loop;

  if v_integrity_map <> '{}'::jsonb then
    new.evidence := coalesce(new.evidence, '{}'::jsonb) || jsonb_build_object(
      'checkpoint_atomicity', v_integrity_map,
      'checkpoint_pass', not exists (
        select 1 from jsonb_each(v_integrity_map) item
        where item.value->>'status' <> 'PASS' or item.value->>'authoritative' <> 'true'
      ),
      'production_2026_09_11_failure_preserved', new.business_date <> date '2026-09-11'
        or exists (select 1 from jsonb_each(v_integrity_map) item where item.value->>'status' = 'FAIL')
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_atomic_checkpoint_acceptance_v1()
  from public, anon, authenticated;

drop trigger if exists enforce_atomic_checkpoint_acceptance on public.production_acceptance_results;
create trigger enforce_atomic_checkpoint_acceptance
before insert on public.production_acceptance_results
for each row execute function public.enforce_atomic_checkpoint_acceptance_v1();

comment on table public.market_checkpoint_batches is
  'Atomic 11-provider checkpoint ledger. Only a fully committed batch is authoritative; pre-cutover evidence remains unbatched and immutable.';
comment on function public.commit_market_checkpoint_batch_v1(date, text, text, uuid, text, jsonb) is
  'Validates and atomically commits exactly 11 checkpoint providers. Retry and concurrent calls return the first committed batch.';
comment on view public.authoritative_market_data_snapshots_v1 is
  'Service-only reader for post-cutover committed, complete and lifecycle-authoritative batches, plus explicit pre-2026-09-11 legacy compatibility; the 2026-09-11 incident is excluded.';

commit;
