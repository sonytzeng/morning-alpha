// Corrective migration against synthetic legacy state; never production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
const sha=s=>createHash('sha256').update(s).digest('hex');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema vnext_runtime;create schema vnext_private;
 create table vnext_runtime.ai_stock_intakes(id uuid,state text,batch_id text);
 create table vnext_runtime.ai_stock_batches(id text,cutoff timestamptz,payload jsonb);
 create function vnext_runtime.validate_daily_ai_market_v1(jsonb,timestamptz,date) returns boolean language sql immutable as $$select true$$;
 create function vnext_runtime.seal_daily_stock_ai_intake_v1() returns trigger language plpgsql as $$begin return new;end$$;
 create function vnext_private.ai_use_primary_documents_v1(text,text[],text[]) returns boolean language sql immutable as $$select false$$;
 create function public.resume_daily_stock_ai_intake_v1(uuid) returns jsonb language sql as $$select '{"state":"OLD_REVISION"}'::jsonb$$;
 create table public.legacy_intakes(id integer primary key,state text,market jsonb,cutoff timestamptz,business_date date,batch_id text,updated_at timestamptz);
 create trigger seal before update or delete on public.legacy_intakes for each row execute function vnext_runtime.seal_daily_stock_ai_intake_v1();`);
 const receipt='2026-10-31T06:00:00Z',business='2026-10-31',source='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=202610';
 const facts={schema:'DAILY_AI_GLOBAL_MARKET_FACT_V1',kind:'US_TREASURY_PAR_YIELD_CURVE',native_symbol:'UST_PAR_YIELD_CURVE',market:'US',session:'DAILY_OBSERVATION',session_date:'2026-10-30',trading_date:'2026-10-30',currency:'USD',unit:'PERCENT',research_business_date:business,
  freshness:'LATEST_AVAILABLE_TREASURY_OBSERVATION',timestamp_basis:'RECEIPT_ONLY_PUBLICATION_UNKNOWN',calendar_version:'TREASURY_XML_ACTUAL_DATES_V1',comparison_basis:'PREVIOUS_AVAILABLE_TREASURY_OBSERVATION',rate_model:'NOMINAL_CONSTANT_MATURITY_PAR_YIELD',
  source_row_date_basis:'NEW_DATE_DATE_COORDINATE_NOT_PUBLICATION',observation_date_coordinate:'2026-10-30T00:00:00',observation_age_calendar_days:1,
  yield_2y:4.56,yield_10y:4.94,yield_30y:5.31,prior_yield_2y:4.61,prior_yield_10y:4.98,prior_yield_30y:5.32,change_2y_bp:-5,change_10y_bp:-4,change_30y_bp:-1,prior_session_date:'2026-10-29',
  received_at:receipt,source_response_sha256:'a'.repeat(64),source_response_bytes:33118};
 const evidence=(content=facts,url=source)=>{const text=JSON.stringify(content);return {id:'global:TREASURY:'+content.session_date,symbol:null,kind:'MARKET',source:url,published_at:null,available_at:content.received_at,first_seen_at:content.received_at,as_of:content.received_at,time_basis:'OBSERVED_AFTER_RECEIPT',content:text,evidence_hash:sha(text)};};
 const oldYahoo=evidence({...facts,kind:'US_CASH_INDEX',native_symbol:'^IXIC',session:'REGULAR',unit:'INDEX_POINTS'},'https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1mo');
 await db.query("insert into public.legacy_intakes values(1,'SOURCED',$1,$2,$3,null,now()),(2,'COMPLETE',$1,$2,$3,'old-batch',now())",[[oldYahoo],receipt,business]);
 const before=(await db.query('select jsonb_agg(to_jsonb(t) order by id) rows from public.legacy_intakes t')).rows[0].rows;
 await db.exec(readFileSync(new URL('../research/daily-ai-market-policy-v2.candidate.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(t) order by id) rows from public.legacy_intakes t')).rows[0].rows,before,'policy migration must retain every legacy record unchanged');
 const validate=async(market,cutoff='2026-10-31T07:00:00Z',day=business)=>(await db.query('select vnext_runtime.validate_daily_ai_market_v1($1,$2,$3) ok',[market,cutoff,day])).rows[0].ok;
 assert.equal(await validate([evidence()]),true);assert.equal(await validate([oldYahoo]),false);
 assert.equal(await validate([evidence(facts,oldYahoo.source)]),false,'Treasury metadata cannot authorize Yahoo URL');
 assert.equal(await validate([evidence({...facts,change_10y_bp:99})]),false);
 assert.equal(await validate([evidence({...facts,unit:'INDEX_POINTS'})]),false);
 assert.equal(await validate([evidence(facts,source.replace('202610','202611'))]),false);
 const noPrior={...facts,prior_session_date:null};for(const tenor of ['2y','10y','30y']){noPrior['prior_yield_'+tenor]=null;noPrior['change_'+tenor+'_bp']=null;}
 assert.equal(await validate([evidence(noPrior)]),true);assert.equal(await validate([evidence({...noPrior,prior_yield_10y:4.98})]),false);
 const nextMonth={...facts,research_business_date:'2026-11-01',received_at:'2026-10-31T23:00:00Z'};assert.equal(await validate([evidence(nextMonth)],'2026-10-31T23:01:00Z','2026-11-01'),true,'Taipei month boundary retains actual prior-month XML observations');
 const future={...facts,received_at:'2026-10-31T01:00:00Z',session_date:'2026-10-31',trading_date:'2026-10-31',observation_date_coordinate:'2026-10-31T00:00:00',observation_age_calendar_days:0};assert.equal(await validate([evidence(future)],'2026-10-31T01:01:00Z'),false,'Treasury future NY date is not accepted as a Taipei date');
 await assert.rejects(()=>db.query("update public.legacy_intakes set state='COMPLETE',batch_id='new-batch',updated_at=now() where id=1"),/AI_INTAKE_MARKET_POLICY/);
 await assert.rejects(()=>db.query("update public.legacy_intakes set batch_id='rewrite' where id=2"),/AI_INTAKE_IMMUTABLE/);
 await db.query("insert into public.legacy_intakes values(3,'SOURCED',$1,$2,$3,null,now())",[[evidence()],receipt,business]);await db.query("update public.legacy_intakes set state='COMPLETE',batch_id='lawful-facts',updated_at=now() where id=3");
 const docs=['https://home.treasury.gov/treasury-daily-interest-rate-xml-feed','https://catalog.data.gov/dataset/interest-rate-statistics-daily-treasury-yield-curve-rates'];
 const primary=async urls=>(await db.query('select vnext_private.ai_use_primary_documents_v1($1,$2,$3) ok',['OPEN_LICENSE',urls,[source]])).rows[0].ok;
 assert.equal(await primary(docs),true);assert.equal(await primary([docs[0]]),false);assert.equal(await primary([docs[1]]),false);
 assert.equal((await db.query('select vnext_private.ai_use_primary_documents_v1($1,$2,$3) ok',['OPEN_LICENSE',docs,[oldYahoo.source]])).rows[0].ok,false);
 await db.exec('set role anon');await assert.rejects(()=>validate([evidence()]),/permission denied/);await db.exec('reset role');
 console.log('PASS: corrective policy retains legacy records, denies Yahoo admission and old SOURCED completion, validates Treasury actual dates/rates/bp/month boundary, recognizes verified CC0 primary document pair without granting rights, and keeps private function access closed. Synthetic isolated fixtures only.');
}catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}finally{await db.close();}
