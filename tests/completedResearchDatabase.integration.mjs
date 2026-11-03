// Isolated PostgreSQL/WASM only. Uses synthetic identities, never production Auth.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {completedFixture,completedResponse} from './helpers/completedResearchFixture.mjs';
const module=process.env.MA_PGLITE_MODULE;assert(module?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(module),db=new PGlite();await db.waitReady;
const checks=[];
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema vnext_runtime;create schema academy_private;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.identity',true)='owner'$$;
 create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.identity',true)$$;
 create function public.market_calendar_session_v1(text,date) returns boolean language sql stable as $$select $1='TW' and $2='2026-10-30'::date$$;
 create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;`);
 const sql=readFileSync(new URL('../supabase/migrations/20261030163000_completed_research_owner_projection.sql',import.meta.url),'utf8');
 await db.exec(sql);checks.push('Exact migration installed into isolated PostgreSQL');
 const localPacket=process.env.MA_COMPLETED_PACKET;
 if(localPacket)assert(localPacket.startsWith('/'),'ABSOLUTE_LOCAL_PACKET_REQUIRED');
 const saved=localPacket?JSON.parse(readFileSync(localPacket,'utf8')):null;
 const packet=saved?{schema:'VNEXT_COMPLETED_OWNER_V1',owner_only:true,snapshot_text:saved.p_text,snapshot_hash:saved.p_hash}:await completedResponse();
 const store=async(p=packet)=>db.query('select public.store_completed_research_v1($1,$2) result',[p.snapshot_text,p.snapshot_hash]);
 await db.exec('set role anon');await assert.rejects(()=>db.query('select public.get_owner_completed_research_v1()'),/permission denied/);
 await db.exec('reset role;set role authenticated');
 for(const id of ['free','premium','revoked']){await db.query("select set_config('test.identity',$1,false)",[id]);await assert.rejects(()=>db.query('select public.get_owner_completed_research_v1()'),/OWNER_REQUIRED/);}
 await assert.rejects(()=>store(),/permission denied/);await assert.rejects(()=>db.query('select * from vnext_runtime.completed_research_snapshots'),/permission denied/);
 checks.push('Anonymous/free/premium/revoked cannot read; authenticated cannot import or read raw table');
 await db.query("select set_config('test.identity','owner',false)");
 assert.equal((await db.query('select public.get_owner_completed_research_v1() result')).rows[0].result.snapshot_text,null);
 await db.exec('reset role;set role service_role');await assert.rejects(()=>db.query('select * from vnext_runtime.completed_research_snapshots'),/permission denied/);
 assert.equal((await store()).rows[0].result.status,'STORED');assert.equal((await store()).rows[0].result.status,'ALREADY_STORED');
 checks.push('Service importer is idempotent; raw table remains private');
 await db.exec('reset role;set role authenticated');await db.query("select set_config('test.identity','owner',false)");
 assert.deepEqual((await db.query('select public.get_owner_completed_research_v1() result')).rows[0].result,packet);
 await db.query("select set_config('test.identity','revoked',false)");await assert.rejects(()=>db.query('select public.get_owner_completed_research_v1()'),/OWNER_REQUIRED/);
 checks.push('Owner reads exact saved bytes; entitlement revocation is effective on next request');
 await db.exec('reset role;set role service_role');
 await assert.rejects(()=>store({...packet,snapshot_hash:'f'.repeat(64)}),/COMPLETED_HASH/);
 for(const mutate of [b=>b.member_published=true,b=>b.forward_sample=1,b=>b.rows.pop(),b=>b.rows[1]={...b.rows[0]},b=>b.evaluated_at='2099-01-01T00:00:00Z',b=>b.focus[0].plan.status='ENTRY_READY',b=>b.focus[0].plan.stop=null]){
  const b=completedFixture();mutate(b);await assert.rejects(()=>completedResponse(b).then(store));
 }
 checks.push('Tamper/promotion/missing or duplicate horizon/future time/unsafe plan rejected atomically');
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from vnext_runtime.completed_research_snapshots')).rows[0].n,1);
 await assert.rejects(()=>db.query("update vnext_runtime.completed_research_snapshots set source_hash=repeat('b',64)"),/IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from vnext_runtime.completed_research_snapshots'),/IMMUTABLE/);
 const boundary=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_runtime.completed_research_snapshots'::regclass")).rows[0];
 assert(boundary.relrowsecurity&&boundary.relforcerowsecurity);checks.push('Failed imports leave one immutable row; RLS forced; UPDATE/DELETE refused');
 console.log(JSON.stringify({checks,passed:checks.length,real_packet_verified:!!saved,snapshot_hash:packet.snapshot_hash,production_writes:0,real_auth_verified:false,postgres:(await db.query('select version() v')).rows[0].v},null,2));
}finally{await db.close();}
