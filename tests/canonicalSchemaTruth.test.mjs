import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const sql=readFileSync(new URL('../supabase/migrations/20260907072722_reconcile_canonical_schema_truth.sql',import.meta.url),'utf8');
const expected={handle_new_user:'4af697fc01a4af733bfd687bb54d82f6',handle_user_email_update:'e5b1798c5ba06caa9b431ac8d52dec98',reject_immutable_market_checkpoint_mutation_v1:'85a162edd9622ea1903e53952f950611'};
test('canonical functions match owner-supplied source and read-only Production normalized hashes',()=>{
  const found={};
  for(const m of sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(\)[\s\S]*?as \$function\$([\s\S]*?)\$function\$/g))found[m[1]]=createHash('md5').update(m[2].toLowerCase().replace(/\s/g,'')).digest('hex');
  assert.deepEqual(found,expected);
});
test('canonical migration retains Auth defaults, immutable identity and private execution',()=>{
  assert.match(sql,/VALUES \(NEW.id, NEW.email, 'free', 'inactive'\)/);
  assert.match(sql,/when \(old.email::text is distinct from new.email::text\)/);
  assert.match(sql,/snapshot_version bigint generated always as identity not null/);
  assert.match(sql,/force row level security/);
  assert.match(sql,/before delete or update on public.market_checkpoint_snapshots/);
  for(const name of Object.keys(expected))assert.ok(sql.includes(`revoke all on function public.${name}() from public, anon, authenticated;`));
  assert.match(sql,/revoke all on public.news_event_tags from public,anon,authenticated/);
  assert.match(sql,/grant select on public.news_event_tags to anon,authenticated/);
  assert.doesNotMatch(sql,/vault\.|service.role.key|eyJ[A-Za-z0-9_-]+\./i);
});
test('Production lifecycle and timestamp functions preserve exact source and security contract',()=>{
  for(const [name,hash] of Object.entries({advance_trading_day_state_v1:'a1af0d71f9ef824c5876816a2040fcc9',set_updated_at:'9b1889f56258bf9d6554213c05019c76'})){
    const definition=sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$`));
    assert.ok(definition,name);
    assert.equal(createHash('md5').update(definition[1]).digest('hex'),hash,name);
  }
  assert.match(sql,/RETURNS trading_day_state\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO ''/);
  assert.match(sql,/FUNCTION public.set_updated_at\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SET search_path TO 'public'/);
  assert.match(sql,/revoke all on function public.advance_trading_day_state_v1\(date,text,text,text,uuid,jsonb\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public.set_updated_at\(\) to public,anon,authenticated,service_role/);
  assert.match(sql,/trigger trg_sector_stock_map_updated_at\s+before update on public.sector_stock_map for each row\s+execute function public.set_updated_at\(\)/);
  assert.match(sql,/trigger market_patterns_set_updated_at\s+before update on public.market_patterns for each row\s+execute function public.cle_set_updated_at_v1\(\)/);
});
test('clean schema replay uses scoped canonical foundation and explicit server audit grants',()=>{
  const foundation=readFileSync(new URL('./fixtures/core-canonical-foundation.sql',import.meta.url),'utf8');
  assert.match(foundation,/EXPLICIT_LOCAL_REBUILD_SCOPE_REQUIRED/);
  assert.match(foundation,/REFERENCES auth.users\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(foundation,/insert into|vault\.|cron\.|sonytzeng@gmail|eyJ[A-Za-z0-9_-]+\./i);
  for(const name of ['profiles','reports','line_subscribers','market_data','sector_stock_map']){
    assert.ok(foundation.includes(`create table public."${name}"`));
    assert.ok(foundation.includes(`alter table public."${name}" enable row level security;`));
  }
  assert.match(sql,/grant all on public.ma_ops_runs, public.ma_ops_checks,/);
  assert.match(sql,/grant all on public.prediction_accuracy_logs, public.system_health_logs to service_role/);
});
