-- Private client-side transport for canonical batches larger than MCP request limits.
-- Chunks grant no publication/access permission and are never exposed by an RPC.
begin;
create table vnext_runtime.ai_stock_batch_upload_chunks(
 batch_id text not null check(batch_id ~ '^[a-f0-9]{64}$'),
 part integer not null check(part between 0 and 99),
 parts integer not null check(parts between 1 and 100 and part<parts),
 chunk_text text not null check(octet_length(chunk_text) between 1 and 512000),
 chunk_hash text not null check(chunk_hash ~ '^[a-f0-9]{64}$'
  and encode(sha256(convert_to(chunk_text,'UTF8')),'hex')=chunk_hash),
 created_at timestamptz not null default clock_timestamp(),
 primary key(batch_id,part)
);
alter table vnext_runtime.ai_stock_batch_upload_chunks enable row level security;
alter table vnext_runtime.ai_stock_batch_upload_chunks force row level security;
revoke all on vnext_runtime.ai_stock_batch_upload_chunks from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_runtime.ai_stock_batch_upload_chunks
 for each row execute function vnext_runtime.immutable();
comment on table vnext_runtime.ai_stock_batch_upload_chunks is
 'Private immutable transport receipts; whole canonical hash is checked again by store_daily_stock_ai_batch_v1.';
commit;
