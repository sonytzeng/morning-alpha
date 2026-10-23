// Offline synthetic controls only. Node CPU is not an Edge SLA or a shutdown diagnosis.
// Run: /opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test tests/vnextTraceValidationBudget.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import {traceIssues} from '../src/features/vnext/researchFunnel.ts';

const BASE='9ca773b354f257d997f1c3c4e42290f412192344';
const root=fileURLToPath(new URL('../',import.meta.url));
const path='src/features/vnext/researchFunnel.ts';
const pinned={
 [path]:'26e0e7e06002834bf7a853d0971147e7e1de40b3daae0cd9c8c10911e1c524c5',
 'src/features/vnext/contracts.ts':'475e7bfc07ccc46c8b66c4f7e2e54bae1b99686df71b4b0a749276c41b2c0d73',
 'src/features/vnext/projection.ts':'8a238c6eacc3972f0f3927346c4081d9e2dcb4c8613bcc4cb1825a3abaf688ae',
};
function immutable(file){
 const source=execFileSync('git',['show',BASE+':'+file],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
 assert.equal(createHash('sha256').update(source).digest('hex'),pinned[file],file+' immutable BASE hash');
 return source;
}
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const baselineSource=immutable(path);
// Both oracle validation dependencies come from git show, never candidate source.
const contractsURL=moduleURL(immutable('src/features/vnext/contracts.ts'));
const projectionURL=moduleURL(immutable('src/features/vnext/projection.ts').replace("'./contracts.ts'",JSON.stringify(contractsURL)));
const start=baselineSource.indexOf('const unique='),end=baselineSource.indexOf('function consecutiveMonths(');
assert(start>0&&end>start,'immutable helper/trace boundaries must exist');
const {traceIssues:baseline}=await import(moduleURL(
 `import {sourceSafe,hashValid} from ${JSON.stringify(contractsURL)};\n`+
 `import {validProjectionTime} from ${JSON.stringify(projectionURL)};\n`+baselineSource.slice(start,end)));

const cutoff='2026-10-22T00:58:00.123Z';
const old='2026-10-21T05:30:00.123Z',future='2026-10-22T00:58:00.124Z';
const fields=['first_seen_at','available_at','as_of','published_at'];
const seed=()=>({id:'SYNTHETIC-trace',source:'https://example.test/synthetic-evidence',evidence_hash:'a'.repeat(64),
 first_seen_at:old,available_at:cutoff,as_of:old,published_at:old});
let differentialCases=0;
function compare(label,trace=seed(),at=cutoff,exact=false){
 const expected=baseline(trace,at,exact),actual=traceIssues(trace,at,exact);
 assert.deepEqual(actual,expected,label+' (ordered array)');
 differentialCases++;
 return actual;
}
function replacing(field,value){const trace=seed();if(field==='cutoff')return [trace,value];trace[field]=value;return [trace,cutoff];}
function outsideBody(source){
 const signature='export function traceIssues(x:Trace,cutoff:string,exactPublication=false){';
 const a=source.indexOf(signature),b=source.indexOf('\n}\nfunction consecutiveMonths(',a);
 assert(a>0&&b>a,'traceIssues body boundaries must exist');
 return source.slice(0,a+signature.length)+source.slice(b);
}

test('immutable oracle is hash-bound; candidate changes only traceIssues body',()=>{
 assert.equal(outsideBody(readFileSync(new URL('../'+path,import.meta.url),'utf8')),outsideBody(baselineSource));
 assert.deepEqual(compare('valid'),[]);
 assert.deepEqual(compare('valid exact',seed(),cutoff,true),[]);
});

test('valid calendar/fraction/offset inputs match BASE in both publication modes',()=>{
 const valid=['2024-02-29T23:59:59Z','2000-02-29T00:00:00+08:00','0000-01-01T00:00:00Z',
  '0099-12-31T23:59:59-03:30','2026-10-21T12:00:00+23:59','2026-10-21T00:00:00-23:59',
  ...Array.from({length:6},(_,i)=>'2026-10-21T05:30:00.'+'123456'.slice(0,i+1)+'Z')];
 for(const value of valid)for(const field of ['cutoff',...fields])for(const exact of [false,true]){
  const [trace,at]=replacing(field,value);compare('valid '+field+' '+value,trace,at,exact);
 }
});

test('invalid times are not made valid by a finite Date.parse or permissive coercion',()=>{
 const invalid=['','bad','2026-10-21','2026-10-21T05:30:00','2026-10-21 05:30:00Z','2026-02-29T00:00:00Z',
  '1900-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-00-01T00:00:00Z','2026-13-01T00:00:00Z',
  '2026-01-00T00:00:00Z','2026-10-21T24:00:00Z','2026-10-21T23:60:00Z','2026-10-21T23:59:60Z',
  '2026-10-21T05:30:00+24:00','2026-10-21T05:30:00+08:60','2026-10-21T05:30:00+0800',
  '2026-10-21T05:30:00.1234567Z','2026-10-21t05:30:00z',' '+old,old+' ',old+'\n',old+'junk',
  undefined,0,1,NaN,Infinity,false,true,[],[old],{},new Date(old),new String(old),Symbol('synthetic'),
  {toString(){throw Error('TIME_MUST_NOT_BE_COERCED');}}];
 for(const value of invalid)for(const field of ['cutoff',...fields])for(const exact of [false,true]){
  const [trace,at]=replacing(field,value);
  // Passing undefined explicitly must not activate compare()'s convenience default.
  const expected=baseline(trace,at,exact),actual=traceIssues(trace,at,exact);
  assert.deepEqual(actual,expected,'invalid '+field+' '+typeof value);differentialCases++;
  assert(actual.includes(field==='published_at'?'PUBLICATION_TIME_INVALID':'TIME_METADATA_MISSING'));
 }
});

test('missing/null/undefined remain distinct, including exact publication mode',()=>{
 for(const field of fields)for(const exact of [false,true]){
  const missing=seed();delete missing[field];compare('missing '+field,missing,cutoff,exact);
  compare('null '+field,{...seed(),[field]:null},cutoff,exact);
  compare('undefined '+field,{...seed(),[field]:undefined},cutoff,exact);
 }
 for(const at of [null,undefined])for(const exact of [false,true]){
  assert.deepEqual(traceIssues(seed(),at,exact),baseline(seed(),at,exact));differentialCases++;
 }
 assert.deepEqual(traceIssues(seed()),baseline(seed()));differentialCases++;
 assert.deepEqual(compare('unknown publication',{...seed(),published_at:null}),[]);
 assert.deepEqual(compare('exact unknown publication',{...seed(),published_at:null},cutoff,true),['PUBLICATION_TIME_UNVERIFIED']);
 assert.deepEqual(compare('undefined publication',{...seed(),published_at:undefined}),['PUBLICATION_TIME_INVALID']);
});

test('mixed timezones, future/order boundaries and original microsecond parse semantics match BASE',()=>{
 const equal=['2026-10-22T00:58:00.123Z','2026-10-22T08:58:00.123+08:00','2026-10-21T21:28:00.123-03:30'];
 for(const first of equal)for(const available of equal)for(const at of equal)for(const exact of [false,true]){
  assert.deepEqual(compare('same instant different zone',{...seed(),first_seen_at:first,available_at:available,
   as_of:equal[1],published_at:equal[2]},at,exact),[]);
 }
 for(const field of fields)for(const value of [old,cutoff,future,'2026-10-22T08:58:00.124+08:00'])for(const exact of [false,true]){
  compare('future/order '+field,{...seed(),[field]:value},cutoff,exact);
 }
 // Full Cartesian chronology/invalidity mixture exercises short-circuit combinations.
 const values=[old,cutoff,future,null,'bad'];
 for(const first of values)for(const available of values)for(const asOf of values)for(const pub of values)for(const exact of [false,true]){
  compare('mixed chronology',{...seed(),first_seen_at:first,available_at:available,as_of:asOf,published_at:pub},cutoff,exact);
 }
 for(const fraction of ['123001','123999','124000'])for(const zone of ['Z','+08:00']){
  const value='2026-10-22T'+(zone==='Z'?'00':'08')+':58:00.'+fraction+zone;
  for(const field of fields)compare('original fraction '+field,{...seed(),[field]:value},cutoff,true);
 }
 assert.deepEqual(compare('existing millisecond boundary',{...seed(),published_at:'2026-10-22T00:58:00.123999Z'}),[]);
 assert.deepEqual(compare('next millisecond',{...seed(),published_at:'2026-10-22T00:58:00.124000Z'}),['FUTURE_EVIDENCE','TIME_ORDER_INVALID']);
});

test('lineage/source rejection and full issue ordering remain identical',()=>{
 const sources=['https://example.test/ok','https://example.test/ok?date=20261022','http://example.test/data',
  'javascript:bad','not a URL','https://example.test/data#fragment','https://synthetic:only@example.test/data',
  'https://example.test/data?token=SYNTHETIC','https://example.test/data?secret=SYNTHETIC',
  'https://example.test/data?key=SYNTHETIC','https://example.test/data?auth=SYNTHETIC','https://example.test/data?email=SYNTHETIC',null,undefined,{}];
 for(const source of sources)for(const exact of [false,true])compare('source',{...seed(),source},cutoff,exact);
 for(const field of ['id','source','evidence_hash']){
  const missing=seed();delete missing[field];compare('lineage missing '+field,missing);
  for(const value of ['',null,undefined,'bad'])compare('lineage '+field,{...seed(),[field]:value});
 }
 for(const pub of [undefined,null]){
  const trace={...seed(),id:'',first_seen_at:null,available_at:old,as_of:future,published_at:pub};
  const expected=['LINEAGE_INVALID','TIME_METADATA_MISSING',pub===null?'PUBLICATION_TIME_UNVERIFIED':'PUBLICATION_TIME_INVALID','FUTURE_EVIDENCE','TIME_ORDER_INVALID'];
  assert.deepEqual(compare('all issues in original order',trace,cutoff,true),expected);
 }
});

test('validation is invocation-local: mutated same object, new rows, cutoffs and publication flags are rechecked',()=>{
 const trace=seed();Object.freeze(trace);
 const before=structuredClone(trace);compare('frozen trace',trace);assert.deepEqual(trace,before);
 const mutable=seed();compare('first call',mutable);
 for(const patch of [{first_seen_at:future},{first_seen_at:'bad'},{source:'http://example.test/invalid'},
  {source:seed().source,first_seen_at:old,published_at:null},{available_at:null},{as_of:undefined}]){
  Object.assign(mutable,patch);compare('changed same reference',mutable,cutoff,true);
 }
 const sameValues=seed();
 for(const at of [cutoff,old,'bad',future])for(const exact of [false,true])compare('new cutoff',sameValues,at,exact);
 compare('separate invalid row',{...seed(),published_at:'bad'});
 compare('no prior-row trust',{...seed(),first_seen_at:'bad'});
 assert.deepEqual(compare('prior results do not leak',seed()),[]);
 const repeated=Array.from({length:3},()=>({trace:seed(),cutoff,exact:false}));
 const counts=repeated.map(input=>parseCounts(traceIssues,[input]));
 assert(counts[0].calls>0);assert.deepEqual(counts[1],counts[0]);assert.deepEqual(counts[2],counts[0]);
});

function parseCounts(fn,inputs){
 const original=Date.parse;let calls=0,validationParses=0,repeated=0,maxPerTrace=0,seen;
 Date.parse=value=>{
  calls++;if(!value.includes('.'))validationParses++;
  if(seen.has(value))repeated++;seen.add(value);return original(value);
 };
 try{
  for(const input of inputs){seen=new Set();const before=calls;fn(input.trace,input.cutoff,input.exact);maxPerTrace=Math.max(maxPerTrace,calls-before);}
 }finally{Date.parse=original;}
 return {calls,validation_parses:validationParses,original_value_parses:calls-validationParses,repeated_same_argument_per_trace:repeated,max_per_trace:maxPerTrace};
}
const workload=Array.from({length:72},(_,stock)=>Array.from({length:250},(_,session)=>{
 const asOf=new Date(Date.UTC(2026,0,1+session,5,30,0,123)).toISOString();
 return {trace:{...seed(),id:`SYNTHETIC-${stock}-${session}`,first_seen_at:cutoff,available_at:cutoff,
  as_of:asOf,published_at:session%2?asOf:null},cutoff,exact:session%3===0};
})).flat();
function sweep(fn){
 let checksum=0;
 for(const input of workload){const issues=fn(input.trace,input.cutoff,input.exact);checksum+=issues.length+(issues[0]?.length??0);}
 return checksum;
}
function cpuSample(fn){
 const startCPU=process.cpuUsage(),startWall=performance.now();
 const checksum=sweep(fn),cpu=process.cpuUsage(startCPU);
 return {cpu_ms:(cpu.user+cpu.system)/1000,wall_ms:performance.now()-startWall,checksum};
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];

test('bounded 72x250 traces: ordered differential outputs and Date.parse budget',t=>{
 assert.equal(workload.length,18000);
 for(const input of workload)compare('72x250 synthetic trace',input.trace,input.cutoff,input.exact);
 const base=parseCounts(baseline,workload),candidate=parseCounts(traceIssues,workload);
 assert(candidate.calls<base.calls,'actual Date.parse calls must decrease');
 assert(candidate.validation_parses<base.validation_parses,'strict validator results are deduplicated, not bypassed');
 assert.equal(candidate.repeated_same_argument_per_trace,0,'fractional synthetic inputs must not reparse the same argument in one invocation');
 assert.equal(candidate.calls,72000,'two distinct valid raw values, each strict-validation parse plus original-value parse');
 assert.equal(candidate.max_per_trace,4);
 t.diagnostic(JSON.stringify({kind:'SYNTHETIC_DATE_PARSE_COUNTS',traces:workload.length,base,candidate,reduction_percent:100*(1-candidate.calls/base.calls)}));
 t.diagnostic(JSON.stringify({kind:'DIFFERENTIAL_CASES',cases:differentialCases,base:BASE,base_source_sha256:pinned[path]}));
});

test('bounded interleaved Node CPU comparison reports measured outcomes without an Edge SLA assertion',t=>{
 // One full warmup each, then five paired sweeps with alternating order. No timers
 // or call-count instrumentation run inside the measured function calls.
 assert.equal(sweep(baseline),sweep(traceIssues));
 const samples={base:[],candidate:[]};
 for(let i=0;i<5;i++)for(const name of i%2?['candidate','base']:['base','candidate']){
  samples[name].push(cpuSample(name==='base'?baseline:traceIssues));
 }
 const checksum=samples.base[0].checksum;
 for(const sample of [...samples.base,...samples.candidate])assert.equal(sample.checksum,checksum);
 const baseMedian=median(samples.base.map(s=>s.cpu_ms)),candidateMedian=median(samples.candidate.map(s=>s.cpu_ms));
 t.diagnostic(JSON.stringify({kind:'SYNTHETIC_NODE_CPU_NOT_EDGE_SLA',node:process.version,traces_per_sweep:workload.length,
  warmup_sweeps_per_implementation:1,measured_sweeps_per_implementation:5,samples,
  base_median_cpu_ms:baseMedian,candidate_median_cpu_ms:candidateMedian,
  median_reduction_percent:100*(1-candidateMedian/baseMedian),cpu_improved_in_this_run:candidateMedian<baseMedian,
  limitation:'Local synthetic Node CPU only; no Edge SLA, end-to-end admission, or production shutdown root-cause claim.'}));
});
