import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE);
const db=new PGlite();await db.waitReady;
const root=new URL('../',import.meta.url);
const baseline=JSON.parse(readFileSync(new URL('scripts/operations/recommendation-delivery-20261107/calendar-baseline.json',root),'utf8'));
const candidate=readFileSync(new URL('research/daily-ai-trading-day-guard.candidate.sql',root),'utf8');
const rollback=readFileSync(new URL('research/daily-ai-trading-day-guard.rollback.sql',root),'utf8');
let checks=0;
const definition=body=>`create or replace function public.tick_daily_stock_ai_intake_v1() returns jsonb language plpgsql security definer set search_path='' as $function$${body}$function$;`;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema vnext_private;
 create table public.test_calls(name text);
 create function public.fixture_now() returns timestamptz language sql stable as $$select current_setting('test.now')::timestamptz$$;
 create function public.authoritative_market_calendar_v1() returns jsonb language sql immutable as $calendar$select '${JSON.stringify(baseline.calendar).replaceAll("'","''")}'::jsonb$calendar$;
 create function vnext_private.resume_zero_paid_stock_draft_v1() returns void language sql as $$insert into public.test_calls values('draft')$$;
 create function public.enqueue_daily_stock_ai_intake_v1() returns jsonb language plpgsql as $$begin insert into public.test_calls values('intake');return '{"state":"ENQUEUED","member_published":false}'::jsonb;end$$;
 ${baseline.calendar_definition};${definition(baseline.ticker_body)}
 revoke all on function public.tick_daily_stock_ai_intake_v1() from public,anon,authenticated;grant execute on function public.tick_daily_stock_ai_intake_v1() to service_role;`);
 const fingerprint=async()=>(await db.query(`select md5(prosrc) body,proacl::text acl,prosecdef,proconfig from pg_proc where oid='public.tick_daily_stock_ai_intake_v1()'::regprocedure`)).rows[0];
 const before=await fingerprint();await db.exec(candidate);const after=await fingerprint();
 assert.equal(after.body,'ec5526cd3dad8cf36651177ea27c2db2');assert.equal(after.acl,before.acl);assert.equal(after.prosecdef,before.prosecdef);assert.deepEqual(after.proconfig,before.proconfig);checks+=4;
 await db.exec(candidate);assert.deepEqual(await fingerprint(),after);checks++;
 const source=(await db.query(`select prosrc from pg_proc where oid='public.tick_daily_stock_ai_intake_v1()'::regprocedure`)).rows[0].prosrc;
 // Test-only clock injection; the actual candidate has no time argument or bypass.
 await db.exec(definition(source.replace('clock_timestamp()','public.fixture_now()')));
 const cases=[['2026-11-07T07:00:00+08:00','NON_TRADING_DAY',0],['2026-11-08T07:00:00+08:00','NON_TRADING_DAY',0],
  ['2026-10-26T07:00:00+08:00','NON_TRADING_DAY',0],['2026-11-09T06:45:00+08:00','OUTSIDE_WINDOW',0],
  ['2026-11-09T06:50:00+08:00','ENQUEUED',2],['2026-11-09T08:55:00+08:00','ENQUEUED',2],
  ['2026-11-09T09:05:00+08:00','OUTSIDE_WINDOW',0],['2027-01-04T07:00:00+08:00','CALENDAR_UNCOVERED',0]];
 for(const [at,state,count] of cases){await db.exec('truncate public.test_calls');await db.query("select set_config('test.now',$1,false)",[at]);
  const result=(await db.query('select public.tick_daily_stock_ai_intake_v1() result')).rows[0].result;
  assert.equal(result.state,state,at);assert.equal(result.member_published,false);assert.equal((await db.query('select count(*)::int n from public.test_calls')).rows[0].n,count);checks++;}
 await assert.rejects(()=>db.exec(rollback),/DAILY_AI_CALENDAR_BASELINE_DRIFT/);await db.exec('rollback');checks++;
 await db.exec(definition(source));await db.exec(rollback);assert.deepEqual(await fingerprint(),before);checks++;
 console.log(JSON.stringify({scope:'DISPOSABLE_POSTGRES_SYNTHETIC_PORTS_ACTUAL_SQL',checks,passed:checks,failed:0,production_written:false}));
}finally{await db.close();}
