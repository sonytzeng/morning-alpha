// SYNTHETIC CONTRACT FIXTURE ONLY. Never a market fact or investment result.
export const cutoff='2026-10-08T00:00:00Z';
export const fixtureHash='a'.repeat(64);
export function fixture(){
 const kinds=['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE','REVENUE','ORDERS','GUIDANCE','INDUSTRY_EVENT','DEMAND','MOAT','SUPPLY_CHAIN','EPS','MARGIN','CAPEX','VALUATION'];
 const evidence=kinds.map((kind,i)=>({id:'synthetic-'+i,symbol:'TEST',kind,source:'SYNTHETIC_OFFICIAL',source_ref:'https://example.com/synthetic/'+i,
  license_id:'synthetic-license',published_at:'2026-10-07T22:00:00Z',first_seen_at:'2026-10-07T22:00:01Z',available_at:'2026-10-07T22:00:02Z',
  as_of:'2026-10-07T13:00:00Z',last_verified_at:'2026-10-07T22:01:00Z',valid_until:'2026-10-09T00:00:00Z',snapshot_hash:fixtureHash,
  quality:'PASS',relevant:true,classification:'CONFIRMED_FACT',summary:'隔離測試依據，非真實行情'}));
 const observation={id:'synthetic-observation',symbol:'TEST',company:'隔離測試公司',horizon:'SHORT',created_at:cutoff,
  as_of:cutoff,available_at:cutoff,last_verified_at:cutoff,next_review_at:'2026-10-09T00:00:00Z',expires_at:'2026-10-20T00:00:00Z',
  reason:'這是契約測試，不是股票推薦。',evidence_ids:evidence.slice(0,4).map(e=>e.id),
  confirmation_conditions:[{text:'測試條件成立才繼續觀察',state:'CONFIRMED',evidence_ids:['synthetic-0']}],
  invalidation_conditions:[{text:'測試條件失效就停止觀察',state:'NOT_MET',evidence_ids:['synthetic-0']}],
  strategy_version:'VNEXT_TEST_1',mode:'FORWARD_SHADOW',snapshot_hash:fixtureHash,publication_status:'APPROVED'};
 const licenses=[{id:'synthetic-license',source:'SYNTHETIC_OFFICIAL',document_url:'https://example.com/synthetic-license',reviewed_at:'2026-10-07T00:00:00Z',expires_at:null,storage:true,derived:true,commercial:true,redistribution:true,attribution:'SYNTHETIC_NOT_A_REAL_LICENSE'}];
 const policy={now:cutoff,approved_snapshot_hash:fixtureHash,approval_at:cutoff,content_kind:'RESEARCH_OBSERVATION',audience:'free'};
 return {evidence,observation,licenses,policy};
}
