import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeDailyStockAnalysisRequest} from '../supabase/functions/_shared/daily-stock-ai-auth.ts';

const internalSecret='test-internal-secret-0123456789',token='test-delivery-token-0123456789';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const request=(headers={},method='POST')=>new Request('https://example.invalid/worker',{method,headers, ...(method==='POST'?{body:'{"batch_id":"test"}'}:{})});
test('existing internal authorization bypasses token lookup; dispatcher hash bridge preserves body',async()=>{
 const original=request({'x-vnext-internal':internalSecret,'x-daily-delivery-token':token});
 assert.equal(await authorizeDailyStockAnalysisRequest(original,{internalSecret,findDeliveryTokenHash:async()=>assert.fail('already authorized')}),original);
 let lookupSignal;
 const bridged=await authorizeDailyStockAnalysisRequest(request({'x-daily-delivery-token':token,'x-test-context':'kept'}),{
  internalSecret,findDeliveryTokenHash:async signal=>{lookupSignal=signal;return {token_hash:await digest(token),is_active:true};}});
 assert.equal(bridged.headers.get('x-vnext-internal'),internalSecret);assert.equal(bridged.headers.get('x-test-context'),'kept');
 assert.equal(await bridged.text(),'{"batch_id":"test"}');assert.equal(lookupSignal.aborted,true);
});
test('browser, method, short secret and invalid token bounds stop before database lookup',async()=>{
 for(const [req,secret] of [[request({'origin':'https://example.invalid','x-daily-delivery-token':token}),internalSecret],
  [request({'x-daily-delivery-token':token},'GET'),internalSecret],[request({'x-daily-delivery-token':token}),'short'],
  [request({'x-daily-delivery-token':'x'.repeat(23)}),internalSecret],[request({'x-daily-delivery-token':'é'.repeat(257)}),internalSecret]]){
  assert.equal(await authorizeDailyStockAnalysisRequest(req,{internalSecret:secret,findDeliveryTokenHash:async()=>assert.fail('unauthorized lookup')}),req);
 }
});
test('inactive, malformed and mismatched stored hashes fail closed',async()=>{
 for(const stored of [null,{is_active:false,token_hash:await digest(token)},{is_active:true,token_hash:'z'.repeat(64)},
  {is_active:true,token_hash:'0'.repeat(64)},{is_active:true,token_hash:(await digest(token)).toUpperCase()}]){
  const req=request({'x-daily-delivery-token':token});
  assert.equal(await authorizeDailyStockAnalysisRequest(req,{internalSecret,findDeliveryTokenHash:async()=>stored}),req);
  assert.equal(req.headers.get('x-vnext-internal'),null);
 }
});
test('database exceptions and bounded lookup cancellation expose no error or credential',async()=>{
 const req=request({'x-daily-delivery-token':token});let lookupSignal;
 assert.equal(await authorizeDailyStockAnalysisRequest(req,{internalSecret,findDeliveryTokenHash:async()=>{throw Error('private database error '+token);}}),req);
 assert.equal(await authorizeDailyStockAnalysisRequest(req,{internalSecret,findDeliveryTokenHash:async signal=>{lookupSignal=signal;return new Promise(()=>{});}},5),req);
 assert.equal(lookupSignal.aborted,true);assert.equal(req.headers.get('x-vnext-internal'),null);
});
