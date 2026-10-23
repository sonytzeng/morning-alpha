// Explicit fresh local PostgreSQL JSONB round trip. Synthetic contract controls,
// not Production data, source admission, financial extraction or member E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {buildOfficialV1SourceCandidate as join} from '../research/recommendation-official-source-join.ts';
import {evidenceRows} from './fixtures/decision-evidence-rows.mjs';
import {COMPANY_EVENT_SOURCES,normalizeCompanyEvents} from '../supabase/functions/_shared/recommendation-company-events.ts';

const socket=process.env.MA_OFFICIAL_JOIN_TEST_SOCKET;
assert.match(socket??'',/^\/private\/tmp\/ma-r12-jsonb-[A-Za-z0-9]+$/,'Explicit isolated Unix socket only');
assert.equal(realpathSync(socket),socket,'Do not follow an alternate local or remote target');
const args=['-X','-h',socket,'-p','55578','-d','postgres','-At','-v','ON_ERROR_STOP=1'];
function sql(statement){return execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',args,
  {input:statement,encoding:'utf8',timeout:5000,stdio:['pipe','pipe','pipe']}).trim();}
assert.equal(sql('select inet_server_addr() is null;'),'t','No TCP server permitted');
assert.equal(sql('show listen_addresses;'),'','Dedicated cluster must not listen on TCP');
assert.match(sql('show server_version;'),/^17\./);
const roundtrip=value=>JSON.parse(sql("select '"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb;"));
const identity={report_date:'2026-10-20',today_date:'2026-10-20',revision_id:'synthetic-fresh-jsonb-control',
  generated_at:'2026-10-20T00:48:00.000Z',data_as_of:'2026-10-20T00:48:00.000Z',is_trading_day:true};
function base(){const data=evidenceRows();for(const key of ['earnings','flows','news','mappings','catalysts'])data[key]=[];return data;}

test('actual PostgreSQL JSONB financial and event re-reads retain full value equality and immutable inputs',async()=>{
 const payload=[{'公司代號':'2330','主旨':'合成控制：季度財報公告','發言日期':'1151020','發言時間':'081000'}];
 const response_body=Buffer.from(JSON.stringify(payload));
 const input={source:COMPANY_EVENT_SOURCES[0],received_at:'2026-10-20T00:11:00.000Z',response_body,
  response_sha256:createHash('sha256').update(response_body).digest('hex')};
 const facts=await normalizeCompanyEvents(input.source,payload,input.received_at,['2330']);
 const subject_reviews=[{symbol:'2330',source_hash:facts[0].source_hash,subject:payload[0]['主旨'],reviewed_at:'2026-10-20T00:12:00.000Z'}];
 const capture={source:'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',
  first_seen_at:'2026-10-20T00:11:00.000Z',available_at:'2026-10-20T00:12:00.000Z',source_response_sha256:'b'.repeat(64),
  status:'CAPTURED_REVIEW_REQUIRED',published_at:null,source_admitted:false,rows:[{
   '公司代號':'2330','出表日期':'1151020','年度':'115','季別':'2','營業收入':'999.00','基本每股盈餘（元）':'1.23',
   period_basis:'AS_REPORTED_PERIOD_BASIS_UNVERIFIED',direct_single_quarter:false,published_at:null,
   consensus:null,guidance:null,source_admitted:false}]};
 const request={identity,announcements:[input],subject_reviews,reported_financial_receipts:[capture]};
 const first=await join({...request,data:base()}),saved=roundtrip(first.data),before=structuredClone(saved);
 assert.notEqual(JSON.stringify(saved.news[0]),JSON.stringify(first.data.news[0]),'Actual server reordered keys');
 assert.notEqual(JSON.stringify(saved.earnings[0]),JSON.stringify(first.data.earnings[0]),'Actual server reordered keys');
 const replay=await join({...request,data:saved});
 assert.deepEqual(saved,before);assert.deepEqual(replay.data,saved);assert.deepEqual(replay.after,first.after);
 assert.equal(replay.after.evaluated,0);assert.equal(replay.production_authorized,false);
 assert.equal(replay.member_publication_approved,false);assert.deepEqual(replay.business_writes,[]);
 const tampered=roundtrip(saved);tampered.earnings.find(r=>r.reported_snapshot_only).source_admitted=true;
 await assert.rejects(join({...request,data:tampered}),/OFFICIAL_FINANCIAL_CONFLICT/);
 const published=roundtrip(saved);published.news[0].publication_approved=true;
 await assert.rejects(join({...request,data:published}),/EXISTING_ROW_CONFLICT/);
 const changed=roundtrip(saved);changed.news[0].symbols=['2317'];
 await assert.rejects(join({...request,data:changed}),/EXISTING_ROW_CONFLICT/);
 assert.equal(sql("select count(*) from pg_tables where schemaname='public';"),'0','No business tables created');
});
