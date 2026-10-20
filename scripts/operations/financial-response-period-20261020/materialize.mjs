// Fixed offline Worker candidate only. No network, RPC, deployment or raw data.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {worker4Baseline} from '../forward-cutoff-20261020/materialize.mjs';
import {verifyIntegrationCandidate} from '../../../tests/helpers/integrationAdmission.mjs';
const root=new URL('../../../',import.meta.url);
export const CHANGED=Object.freeze(['src/features/vnext/dailyRuntime.ts','src/features/vnext/dailyAdapter.ts',
 'src/features/vnext/dailyParsers.mjs','src/features/vnext/dailyIntelligence.ts']);
export const CATALOG='scripts/operations/financial-response-period-20261020/release-catalog.json';
export const CATALOG_SHA256='1071bb23211b7afb61d6d51c03359dfe7f11113af3f3b05459060e1d8faf8c91';
const sha=b=>createHash('sha256').update(b).digest('hex');
const encode=o=>Buffer.from(JSON.stringify(o,null,2)+'\n');
const physical=path=>{const url=new URL(path,root);assert(lstatSync(url).isFile()&&!lstatSync(url).isSymbolicLink(),'FINANCIAL_REGULAR_SOURCE');return readFileSync(url);};
export function propose(confirmed,read=physical){
 assert.deepEqual(Object.keys(confirmed).sort(),[...CHANGED].sort(),'FINANCIAL_EXACT_SOURCE_SCOPE');
 const old=worker4Baseline(),replacements=new Map(CHANGED.map(p=>{
  const bytes=Buffer.from(read(p));assert.equal(sha(bytes),confirmed[p],'FINANCIAL_SOURCE_NOT_CONFIRMED');
  const text=bytes.toString('utf8');assert(Buffer.from(text).equals(bytes),'FINANCIAL_SOURCE_UTF8');return [p,text];
 }));
 const candidate={...old.payload,files:old.payload.files.map(f=>replacements.has(f.name)?{name:f.name,content:replacements.get(f.name)}:{...f})};
 assert.equal(candidate.verify_jwt,true);assert.equal(candidate.files.length,78);
 assert(CHANGED.every(p=>old.payload.files.some(f=>f.name===p)),'FINANCIAL_RUNTIME_CLOSURE_MISSING');
 return {schema:'FINANCIAL_RESPONSE_PERIOD_RELEASE_V1',production_authorized:false,base:'7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3',
  confirmed_sources:confirmed,metadata:Object.fromEntries(Object.entries(candidate).filter(([k])=>k!=='files')),
  changes:CHANGED.map(p=>({path:p,before_sha256:sha(old.payload.files.find(f=>f.name===p).content),after_sha256:confirmed[p]})),
  payloads:{candidate:{sha256:sha(encode(candidate)),bytes:encode(candidate).length},recovery:{sha256:old.sha256,bytes:old.bytes.length}},
  sdk:'2.57.4',verify_jwt:true,sql:false,source_admission:false,formal_v1_threshold_change:false,
  caller_change:false,member_rights_change:false,payment_change:false,manual_research_run:false,
  recovery:'FIXED_WORKER4_SOURCE_FUNCTIONAL_EQUIVALENCE_NOT_IDENTICAL_PHYSICAL_ESZIP'};
}
export function assemble(variant='candidate',read=physical){
 assert(['candidate','recovery'].includes(variant),'FINANCIAL_FIXED_VARIANT');
 verifyIntegrationCandidate(read);
 const bytes=read(CATALOG);assert.equal(sha(bytes),CATALOG_SHA256,'FINANCIAL_CATALOG_DRIFT');
 const c=JSON.parse(bytes);assert.deepEqual(c,propose(c.confirmed_sources,read),'FINANCIAL_CATALOG_CONTRACT');
 const base=worker4Baseline(),payload=variant==='recovery'?base.payload:{...base.payload,
  files:base.payload.files.map(f=>CHANGED.includes(f.name)?{name:f.name,content:read(f.name).toString('utf8')}:{...f})};
 const encoded=encode(payload);assert.equal(sha(encoded),c.payloads[variant].sha256,'FINANCIAL_PAYLOAD_DRIFT');
 assert.equal(encoded.length,c.payloads[variant].bytes);verifyIntegrationCandidate(read);
 return {payload,bytes:encoded,sha256:sha(encoded)};
}
