import {canonical} from '../../research/entry-opportunity.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
export function completedFixture(){return {schema:'VNEXT_COMPLETED_RESEARCH_V1',mode:'AS_OF_RESEARCH',owner_only:true,member_published:false,forward_sample:0,outcome_sample:0,
 data_through:'2026-10-30',evaluated_at:'2026-10-30T13:38:50.526Z',source_hash:'a'.repeat(64),
 rows:Array.from({length:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(h=>({symbol:String(2000+i),company:'合成控制 '+i,horizon:h,state:h==='LONG'?'INSUFFICIENT':'QUALIFIED',
  close:100,reason:'合成測試理由',confirmation:'合成測試確認',invalidation:'合成測試失效',risk:'合成測試風險',gaps:[],sources:['https://www.twse.com.tw/zh/']}))).flat(),
 focus:[{symbol:'2000',horizons:['SHORT'],decision:'合成待確認',reason:'合成測試理由',confirmation:'合成測試確認',invalidation:'合成測試失效',risk:'合成測試風險',sources:['https://www.twse.com.tw/zh/'],
  plan:{status:'WAIT_CONFIRMATION',range:[100,101],no_chase:102,stop:95,scenario:120,reward_risk:2.5,valid_from:'2026-11-02T09:00:00+08:00',valid_until:'2026-11-02T13:30:00+08:00',pending:['合成事件待核對']}}]};}
export async function completedResponse(body=completedFixture()){return {schema:'VNEXT_COMPLETED_OWNER_V1',owner_only:true,snapshot_text:canonical(body),snapshot_hash:await snapshotHash(body)};}
