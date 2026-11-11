/** Disposable PostgreSQL verification of the actual Owner probe's cleanup.
 * All auth identities/functions here are SYNTHETIC. No retained DB is opened. */
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { createOwnerAuthRollbackGuard } from '../scripts/operations/verify-taiwan-market-owner-real.mjs';

if (!process.env.MA_PGLITE_MODULE) throw Error('MA_PGLITE_MODULE_REQUIRED');
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite();
await db.waitReady;
const snapshot = async () => (await db.query(`select n.nspname,p.proname,pg_get_functiondef(p.oid) definition,
  p.proacl::text acl,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in(('auth','uid'),('academy_private','access_v11'),('public','is_research_owner_v1'))
  order by n.nspname,p.proname`)).rows;
let phase = 0;
const passed = label => console.log(JSON.stringify({ phase: ++phase, state: 'PASS', label }));
try {
  await db.exec(`create schema auth;create schema academy_private;
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function academy_private.access_v11() returns text language sql stable as $$select 'SYNTHETIC_ORIGINAL_DENIED'::text$$;
    create function public.is_research_owner_v1() returns boolean language sql stable as $$select false$$;`);
  const original = await snapshot();

  const partialSetup = createOwnerAuthRollbackGuard({ query: (...args) => db.query(...args), exec: sql => {
    if (sql.startsWith('create or replace function auth.uid()')) {
      const first = sql.slice(0, sql.indexOf('create or replace function academy_private.access_v11()'));
      return db.exec(first + 'select 1/0;');
    }
    return db.exec(sql);
  } });
  await assert.rejects(partialSetup.begin(), error => error.code === '22012');
  assert.equal(partialSetup.active, true);
  await partialSetup.restore();
  assert.equal(partialSetup.restored, true); assert.equal(partialSetup.active, false);
  assert.deepEqual(await snapshot(), original);
  passed('Failure after first real CREATE replacement rolls back bodies, ACL and owners.');

  const lateFailure = createOwnerAuthRollbackGuard(db); await lateFailure.begin();
  await db.exec("select set_config('test.market_owner_id','00000000-0000-4000-8000-000000009001',true),set_config('test.market_owner_tier','owner',true)");
  assert.equal((await db.query('select public.is_research_owner_v1() allowed')).rows[0].allowed, true);
  await assert.rejects(db.exec('select 1/0'), error => error.code === '22012');
  await lateFailure.restore(); assert.equal(lateFailure.restored, true);
  assert.deepEqual(await snapshot(), original);
  passed('Failure after authenticated read setup restores the original helpers.');

  const success = createOwnerAuthRollbackGuard(db); await success.begin();
  await success.restore(); await success.restore();
  assert.equal(success.restored, true); assert.equal(success.active, false);
  assert.deepEqual(await snapshot(), original);
  assert.equal((await db.query('select public.is_research_owner_v1() allowed')).rows[0].allowed, false);
  passed('Successful read cleanup is idempotent and leaves no synthetic Owner state.');
} finally { await db.close(); }
