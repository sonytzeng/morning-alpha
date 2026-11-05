/** Append-only V2 lifecycle seal of the already reviewed three judgments.
 * No new market/source fetch, permission grant, model or production operation. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../../../src/features/vnext/contracts.ts';
const [evidencePath,outputName='2330-long-bound-reviews-v2-source']=process.argv.slice(2);
if(!evidencePath||!/^[A-Za-z0-9-]+$/.test(outputName))throw Error('Expected evidence_directory optional_new_prefix');
const base=resolve(evidencePath),old='2330-long-reviewed-source-candidate',path=n=>resolve(base,n),sha=b=>createHash('sha256').update(b).digest('hex');
const read=async n=>JSON.parse(await readFile(path(n),'utf8'));
const mf=await read(old+'.manifest.json'),{source_seal_hash,...mfBody}=mf;
if(await snapshotHash(mfBody)!==source_seal_hash)throw Error('PRIOR_REVIEW_SEAL');
const priorFiles={};
for(const entry of [mf.facts_file,mf.review_file,mf.receipt_file]){
 const raw=await readFile(path(basename(entry.path)));if(raw.length!==entry.bytes||sha(raw)!==entry.sha256)throw Error('PRIOR_FILE_DRIFT');
 priorFiles[basename(entry.path)]=JSON.parse(raw);
}
const oldFacts=priorFiles[old+'.facts.json'],oldReview=priorFiles[old+'.review.json'],oldReceipt=priorFiles[old+'.receipt.json'];
const scenario=await read('2330-valuation-scenario-candidate.json');
const model=(s,r=s.required_equity_return)=>{
 const e0=scenario.retained_facts.eps0_twd,gh=s.growth_first_five_years,rh=s.incremental_return_on_retained_equity,
  gt=s.perpetual_growth,rt=s.terminal_incremental_return_on_retained_equity;
 let pv=0;for(let t=1;t<=5;t++)pv+=e0*(1+gh)**t*(1-(t<5?gh/rh:gt/rt))/(1+r)**t;
 return pv+e0*(1+gh)**5*(1+gt)*(1-gt/rt)/(r-gt)/(1+r)**5;
};
for(const s of scenario.scenarios){if(Math.abs(model(s)-s.result.model_value_per_common_share_twd)>1e-8)throw Error('PRIOR_MODEL_RECOMPUTATION');}
const optimistic=scenario.scenarios.find(s=>s.id==='OPTIMISTIC'),r8=model(optimistic,.08);
const quarterly=await read('sec-exhibit-receipts.json'),annual=await read('sec-2025-20f-review.receipt.json');
let verified=0;
for(const receipt of quarterly){const raw=await readFile(path(`sec-${receipt.period}-${receipt.kind}.html`));
 if(raw.length!==receipt.bytes||sha(raw)!==receipt.sha256)throw Error('PRIMARY_RAW_DRIFT');verified++;}
const annualRaw=await readFile(path('sec-2025-20f-review.html'));
if(annualRaw.length!==annual.bytes||sha(annualRaw)!==annual.sha256)throw Error('ANNUAL_RAW_DRIFT');verified++;
const binding={symbol:'2330',session_date:'2026-10-30',close_twd:2370,unit:'TWD_PER_COMMON_SHARE',scope:'RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE'};
const until='2026-11-02T13:30:00+08:00',prepared=new Date().toISOString();
const review={...structuredClone(oldReview),schema:'2330_BOUND_THREE_DOCUMENTED_REVIEWS_V2',prepared_at:prepared,
 prior_review_seal:{source_seal_hash,review_sha256:mf.review_file.sha256,receipt_sha256:mf.receipt_file.sha256,
  original_cutoff:mf.cutoff,original_files_unchanged:true},
 lifecycle_policy:{review_valid_until:until,review_price_basis:binding,
  active_rule:'SOURCE cutoff strictly before valid_until; retained through/date and sole close equal bound basis; original twelve SEC facts complete.',
  invalidation_action:'Retain original registry/history; remove these three reviews from the new working projection and return LONG to INSUFFICIENT. Do not block all 72 companies.',
  valid_until_reason_zh:'有效期上限設在下一個正常交易日收盤；若此前資料日期或價格變動，也立即停止沿用，等待新版本重審。'},
 unchanged_three_judgments:{DEMAND:'SUPPORTED',MOAT:'SUPPORTED',VALUATION:'NOT_SUPPORTED',scope:'Bound TWD2370 quote and the original three scenario/policy comparisons only.'},
 scenario_values_and_original_assumptions:scenario.scenarios.map(s=>({id:s.id,g_H:s.growth_first_five_years,R_H:s.incremental_return_on_retained_equity,
  r:s.required_equity_return,g_T:s.perpetual_growth,R_T:s.terminal_incremental_return_on_retained_equity,
  model_value_twd:s.result.model_value_per_common_share_twd,discount_25_threshold_twd:s.result.margin_thresholds.find(m=>m.required_buffer_fraction===.25).price_threshold_twd,
  terminal_fraction:s.result.terminal_value_fraction})),
 sensitivity_counterexample:{only_changed:'Optimistic required return 9% to 8%; all other optimistic inputs unchanged',required_return:.08,
  model_value_twd:r8,discount_25_threshold_twd:r8*.75,retained_price_meets_discount:2370<=r8*.75,
  interpretation_zh:'要求報酬改為8%的樂觀敏感度反例會滿足25%折讓條件；這不是本版三個固定情境之一，也不是市場已校準的報酬率，說明等待判定依賴參數，不是無條件高估。'},
 source_admitted:false,member_publication_approved:false};
const reviewText=JSON.stringify(review,null,2)+'\n',reviewFile=outputName+'.review.json';
await writeFile(path(reviewFile),reviewText,{flag:'wx'});
const retainedReview=await readFile(path(reviewFile)),reviewHash=await snapshotHash(review),received=new Date().toISOString();
const receiptBody={...structuredClone(oldReceipt),schema:'2330_BOUND_REVIEW_RECEIPT_V2',source_batch_id:outputName,received_at:received,
 review_file:{path:'evidence/'+reviewFile,bytes:retainedReview.length,sha256:sha(retainedReview)},review_canonical_hash:reviewHash,
 review_valid_until:until,review_price_basis:binding,prior_review_source_seal:source_seal_hash,
 original_receipts_rewritten:false,source_admitted:false,member_publication_approved:false};delete receiptBody.receipt_hash;
const receipt={...receiptBody,receipt_hash:await snapshotHash(receiptBody)},receiptText=JSON.stringify(receipt,null,2)+'\n';
await writeFile(path(outputName+'.receipt.json'),receiptText,{flag:'wx'});
const facts=[];
for(const oldFact of oldFacts){
 const {evidence_hash,...body}=structuredClone(oldFact);
 body.id=`own-documented-review:2330:${body.kind}:${reviewHash}`;body.published_at=null;
 body.first_seen_at=received;body.available_at=received;body.reviewed_at=prepared;
 body.review_valid_until=until;body.review_price_basis=binding;
 body.values={...body.values,review_sha256:sha(retainedReview),review_canonical_hash:reviewHash,source_receipt_hash:receipt.receipt_hash,
  review_valid_until:until,review_price_session_date:binding.session_date,review_price_close_twd:binding.close_twd,review_price_scope:binding.scope,
  lifecycle_zh:'本研究只適用保留的2026-10-30收盤2370元，且須早於2026-11-02台北13:30；價格、資料日期或有效期改變時停用三筆並重審，不把舊判定套用新價格。',
  source_authority_zh:'SEC文件是原始申報輸入；SUPPORTED／NOT_SUPPORTED是Morning Alpha自有條件式研究判斷，不是SEC或公司給的估值裁決。'};
 body.source_locator={...body.source_locator,review_file:'evidence/'+reviewFile,review_sha256:sha(retainedReview),review_canonical_hash:reviewHash,
  source_receipt_file:'evidence/'+outputName+'.receipt.json',source_receipt_hash:receipt.receipt_hash};
 if(body.kind==='VALUATION'){
  for(const s of review.scenario_values_and_original_assumptions)for(const [key,value] of Object.entries(s))if(key!=='id')body.values[s.id.toLowerCase()+'_'+key]=value;
  body.values.scenario_assumptions_zh='三情境依序為保守／基準／樂觀：前5年成長6%／12%／18%，新增再投資報酬12%／25%／30%，要求報酬12%／10%／9%，永續成長2%／3%／4%，成熟期再投資報酬12%／15%／20%；都是分析假設，不是公司預測。';
  body.values.comparison_zh='保留2370元高於三情境各自25%折讓門檻約651／1174／2055元。樂觀模型值約2740元仍高於2370，但25%折讓門檻約2055低於2370；因此不是三情境都認定高估，也不是保證買入價。';
  body.values.optimistic_r8_counterexample_required_return=.08;body.values.optimistic_r8_counterexample_value_twd=r8;
  body.values.optimistic_r8_counterexample_discount25_twd=r8*.75;body.values.optimistic_r8_counterexample_meets_policy='TRUE';
  body.values.optimistic_r8_counterexample_zh=review.sensitivity_counterexample.interpretation_zh;
  body.values.distribution_limitations_zh='模型折現的是假設分配，不是已核實FCFE或已宣布股利。終值約占73%至89%，EPS98.26未正常化；TIFRS季度與IASB年報未和解，不可混接。25%是所選條件，不保證本金或報酬。';
 }
 facts.push({...body,evidence_hash:await snapshotHash(body)});
}
const factsText=JSON.stringify(facts,null,2)+'\n';await writeFile(path(outputName+'.facts.json'),factsText,{flag:'wx'});
await new Promise(r=>setTimeout(r,1));const cutoff=new Date().toISOString();
const manifestBody={schema:'2330_THREE_BOUND_DOCUMENTED_REVIEWS_SOURCE_SEAL_V2',source_batch_id:outputName,cutoff,
 review_file:{path:'evidence/'+reviewFile,bytes:retainedReview.length,sha256:sha(retainedReview)},review_canonical_hash:reviewHash,
 receipt_file:{path:'evidence/'+outputName+'.receipt.json',bytes:Buffer.byteLength(receiptText),sha256:sha(receiptText)},receipt_hash:receipt.receipt_hash,
 facts_file:{path:'evidence/'+outputName+'.facts.json',bytes:Buffer.byteLength(factsText),sha256:sha(factsText)},
 facts_canonical_sha256:await snapshotHash(facts),review_valid_until:until,review_price_basis:binding,declared_fact_count:3,
 fact_hashes:facts.map(f=>({id:f.id,kind:f.kind,verdict:f.values.verdict,evidence_hash:f.evidence_hash})),
 source_admitted:false,member_publication_approved:false,original_receipts_rewritten:false,primary_documents_verified:verified};
const manifest={...manifestBody,source_seal_hash:await snapshotHash(manifestBody)};
await writeFile(path(outputName+'.manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prefix:outputName,cutoff,received_at:received,source_seal_hash:manifest.source_seal_hash,
 facts_sha256:manifest.facts_canonical_sha256,primary_documents_verified:verified,production_writes:0}));
