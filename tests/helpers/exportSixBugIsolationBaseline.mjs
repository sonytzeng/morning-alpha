// One-time, schema-only export of the already controlled local Failure Hunt
// baseline. Never accepts a URL, credentials, arbitrary container or Production.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(process.argv[2],'--scope=ma-six-bug-local-baseline');
const container='ma-hunt-0930-db';
const sql=s=>execFileSync('docker',['exec',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'}).trim();
const pins={
 'commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)':'8b73a0da9bdb1da57102f2d75da67f9c',
 'advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)':'c0f2f9a050448d6810cfdda614626529',
 'capture_morning_alpha_acceptance_v1(date,text)':'c9c4742a389523fa900f62b20241631f',
 'invoke_premarket_readiness_retry_v1()':'df9266768b6463755e9d90013adc0f60',
};
for(const [signature,hash]of Object.entries(pins))assert.equal(sql(`select md5(pg_get_functiondef('public.${signature}'::regprocedure))`),hash);
let schema=execFileSync('docker',['exec',container,'pg_dump','-U','postgres','--schema-only','--no-owner','--no-privileges','--no-comments','--schema=public','--schema=auth'],{encoding:'utf8',maxBuffer:2e6});
schema=schema.replace(/^\\(?:un)?restrict .*\n/gm,'');
// Secrets are not schema metadata. Abort rather than exporting suspect literals.
assert.doesNotMatch(schema,/eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.|sb_secret_[A-Za-z0-9_-]+|sk-[A-Za-z0-9]{20,}/);
assert.doesNotMatch(schema,/^COPY .* FROM stdin;|^INSERT INTO /m);
const prefix='-- ISOLATED_SCHEMA_ONLY_BASELINE: no business rows; never a Production migration.\n';
const rawOutput=prefix+schema;
const output=rawOutput.replace(/[ \t]+$/gm,'').trimEnd()+'\n';
const path=new URL('../fixtures/six-bug-schema-only-20260930.sql',import.meta.url);
writeFileSync(path,output);
writeFileSync(new URL('../fixtures/six-bug-schema-only-20260930.json',import.meta.url),JSON.stringify({
 schema_version:'SIX_BUG_ISOLATION_SCHEMA_BASELINE_V1',source:'CONTROLLED_LOCAL_FAILURE_HUNT_BASELINE',
 source_main:'2e530bc0db49bf76d6188642b79e112b339872aa',business_rows:0,production_access:false,
 source_export_sha256:createHash('sha256').update(rawOutput).digest('hex'),
 normalization:'TRAILING_WHITESPACE_ONLY; protected business function hashes are unchanged',
 sha256:createHash('sha256').update(output).digest('hex'),function_predecessor_hashes:pins,
 required_prior_observability_migration:'20260923124500_production_evidence_recorder_v1.sql',
},null,2)+'\n');
console.log(JSON.stringify({schema_bytes:Buffer.byteLength(output),business_rows:0,secret_literal_detected:false}));
