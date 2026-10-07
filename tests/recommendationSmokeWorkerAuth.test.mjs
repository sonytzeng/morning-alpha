import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeSmokeWorker} from '../supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts';
const now=Date.parse('2026-10-07T05:00:00Z'),token='a'.repeat(64);
const input={'x-recommendation-smoke-token':token,'x-recommendation-smoke-version':'1','x-recommendation-smoke-issued-at':String(now)};
test('dedicated valid worker; JWT gateway is separate and remains enabled',async()=>{
 assert.equal((await authorizeSmokeWorker(new Headers(input),token,now)).ok,true);
});
test('missing, wrong, Core, Owner, member, paid and service-role alone are denied',async()=>{
 for(const headers of [{},{'x-cron-secret':'SYNTHETIC_CORE'},{Authorization:'Bearer SYNTHETIC.OWNER.JWT'},{Authorization:'Bearer SYNTHETIC.MEMBER.JWT'},{Authorization:'Bearer SYNTHETIC.PAID.JWT'},{apikey:'SYNTHETIC_SERVICE_ROLE'},{...input,'x-recommendation-smoke-token':'b'.repeat(64)}])
  assert.equal((await authorizeSmokeWorker(new Headers(headers),token,now)).ok,false);
});
test('browser, stale, future, wrong-version and unconfigured identity never dispatch',async()=>{
 for(const changes of [{origin:'https://morningalphatw.com'},{referer:'https://morningalphatw.com/account'},{'sec-fetch-site':'same-origin'},{'x-recommendation-smoke-version':'2'},{'x-recommendation-smoke-issued-at':String(now-300001)},{'x-recommendation-smoke-issued-at':String(now+30001)}])
  assert.equal((await authorizeSmokeWorker(new Headers({...input,...changes}),token,now)).ok,false);
 assert.equal((await authorizeSmokeWorker(new Headers(input),'',now)).ok,false);
});
