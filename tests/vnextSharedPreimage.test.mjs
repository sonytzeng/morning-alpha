// Isolated controls only. No provider, natural sample, permission or publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inputSnapshotHashes,snapshotHash} from '../src/features/vnext/contracts.ts';

test('canonical input hashes remain byte-equivalent for ordered, nested and unicode values',async()=>{
 const values=[null,true,false,0,-0,1.234,1e30,'台股\u0000é🙂',[],{},[1,null,'x'],{z:2,a:{b:3,a:[false,0]}}];
 for(const entry of values){
  const hashes=await inputSnapshotHashes(values,entry);
  assert.deepEqual(hashes,await Promise.all(values.map(input=>snapshotHash({input,entry}))));
 }
});

test('full Entry canonicalization occurs once; every full input and complete Entry remain bound',async()=>{
 let reads=0;const entry={stocks:Array.from({length:72},(_,i)=>({symbol:String(i),bars:[{close:i,amount:100}]}))};
 Object.defineProperty(entry,'observed',{enumerable:true,get(){reads++;return 'isolated-control';}});
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(i),bars:[{close:i}]}));
 const hashes=await inputSnapshotHashes(inputs,entry);
 assert.equal(reads,1,'do not serialize the complete shared capsule once per stock');
 for(let i=0;i<inputs.length;i++)assert.equal(hashes[i],await snapshotHash({input:inputs[i],entry}));
 entry.stocks.at(-1).bars[0].amount++;
 const changedEntry=await inputSnapshotHashes(inputs,entry);
 assert(changedEntry.every((hash,i)=>hash!==hashes[i]),'even an unrelated stock in Entry changes every evidence hash');
 inputs[0].bars[0].close++;
 const changedInput=await inputSnapshotHashes(inputs,entry);
 assert.notEqual(changedInput[0],changedEntry[0]);assert.deepEqual(changedInput.slice(1),changedEntry.slice(1));
});

test('no revision/call cache and no simultaneous full-Entry digest buffers',async t=>{
 const digest=crypto.subtle.digest.bind(crypto.subtle);let active=0,maxActive=0,count=0;
 t.mock.method(crypto.subtle,'digest',async(...args)=>{count++;active++;maxActive=Math.max(maxActive,active);
  try{await Promise.resolve();return await digest(...args);}finally{active--;}});
 const inputs=[{x:1},{x:2}],entry={stocks:[{x:1}]};
 const first=await inputSnapshotHashes(inputs,entry);entry.stocks[0].x=2;
 const second=await inputSnapshotHashes(inputs,entry);
 assert.equal(count,4);assert.equal(maxActive,1);assert.equal(active,0);
 assert(first.every((hash,i)=>hash!==second[i]));
});

test('noncanonical input remains rejected, not silently omitted or normalized',async()=>{
 for(const invalid of [undefined,NaN,Infinity,()=>1,Symbol('isolated'),{x:undefined}]){
  await assert.rejects(inputSnapshotHashes([invalid],null),/NON_CANONICAL_VALUE/);
  await assert.rejects(inputSnapshotHashes([{}],invalid),/NON_CANONICAL_VALUE/);
 }
});

test('72x250 synthetic full-input scope matches the original hash for every stock',async t=>{
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(i),bars:Array.from({length:250},(_,d)=>({date:d,close:100+i,amount:1000000+d}))}));
 const entry={stocks:inputs.map(i=>({symbol:i.symbol,bars:i.bars.slice(-20)})),source_revision:'a'.repeat(64)};
 const hashes=await inputSnapshotHashes(inputs,entry),expected=[];
 for(const input of inputs)expected.push(await snapshotHash({input,entry}));
 assert.equal(hashes.length,72);assert.deepEqual(hashes,expected);
 t.diagnostic(JSON.stringify({kind:'SYNTHETIC_72x250_SCOPE_EQUIVALENCE',inputs:72,bars:18000,scope_changed:false,forward_sample:0}));
});


test('shared UTF-8 prefix preserves the complete canonical preimage and SHA-256',async t=>{
 const inputs=[null,true,false,0,-0,1.25,[],{},'台積電🙂',{'𠮷':'\ud800',quote:'"\\\n'},[null,{z:1,a:2}],'x'.repeat(10000),null,'short'];
 const entry={company:'測試🙂',nested:{z:null,a:['\udfff','漢字']},number:1e-10};
 const expected=await Promise.all(inputs.map(input=>snapshotHash({entry,input})));
 const digest=crypto.subtle.digest.bind(crypto.subtle),decoder=new TextDecoder();
 let active=0,peak=0;const actualPreimages=[];
 t.mock.method(crypto.subtle,'digest',async(algorithm,bytes)=>{
  active++;peak=Math.max(peak,active);actualPreimages.push(decoder.decode(bytes));
  const copy=Uint8Array.from(bytes);await Promise.resolve();assert.deepEqual(bytes,copy);
  try{return await digest(algorithm,bytes);}finally{active--;}
 });
 assert.deepEqual(await inputSnapshotHashes(inputs,entry),expected);
 assert.equal(actualPreimages.length,inputs.length);assert.equal(peak,1);
 for(let i=0;i<inputs.length;i++)assert.deepEqual(JSON.parse(actualPreimages[i]),JSON.parse(JSON.stringify({entry,input:inputs[i]})));
});

test('the shared Entry is UTF-8 encoded once per call, with no cross-call cache',async t=>{
 const encode=TextEncoder.prototype.encode;let prefixes=0;
 t.mock.method(TextEncoder.prototype,'encode',function(value){if(value.startsWith('{"entry":'))prefixes++;return encode.call(this,value);});
 const entry={stock:'2330',amount:100},inputs=Array.from({length:72},(_,i)=>({symbol:String(i)}));
 const before=await inputSnapshotHashes(inputs,entry);assert.equal(prefixes,1);
 entry.amount++;
 const after=await inputSnapshotHashes(inputs,entry);assert.equal(prefixes,2);
 assert(before.every((hash,i)=>hash!==after[i]));
 assert.deepEqual(await inputSnapshotHashes([],entry),[]);
});

test('unsupported canonical values still fail closed',async()=>{
 for(const invalid of [undefined,NaN,Infinity,()=>{},Symbol('x')]){
  await assert.rejects(inputSnapshotHashes([invalid],null),/NON_CANONICAL_VALUE/);
  await assert.rejects(inputSnapshotHashes([null],invalid),/NON_CANONICAL_VALUE/);
 }
});
