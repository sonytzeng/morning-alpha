import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
const path='docs/operations/evidence/owner-release-review-r8-20261017.json';
const bytes=readFileSync(new URL(path,root));
const p=JSON.parse(bytes);
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(new URL(name,root));
const revision='b29ee8a80f798c20d8ae5e9234ade8544852d10f';
const before=name=>execFileSync('git',['--no-replace-objects','show',revision+':'+name],{cwd:root,maxBuffer:1024*1024});

test('Owner package identifies immutable R7 and never converts prior CI into current or Production approval',()=>{
 assert.equal(p.schema,'MORNING_ALPHA_OWNER_REVIEW_SAFE_PACKAGE_R8_20261017');
 assert.equal(p.source_release_head,revision);
 assert.equal(p.base,'754850ba1c66329d12eac8e98ab799e0a0c9123e');
 assert.equal(p.production_authorized,false);
 assert.equal(p.r7_range.incremental_files,17);
 assert.equal(p.r7_range.complete_pr_files,189);
 assert.equal(p.r7_range.rows.length,188);
 assert.equal(p.proof_reuse.exact_head_ci,'13/13_PASS_R7_ONLY');
 assert.match(p.proof_reuse.new_delivery_head_ci,/NOT_R7/);
 const old=before(p.r7_range.source_manifest);
 assert.equal(hash(old),p.r7_range.manifest_sha256);
 assert.deepEqual(read(p.r7_range.source_manifest),old);
 assert.deepEqual(JSON.parse(old).files,p.r7_range.rows);
});

test('complete deploy scopes retain exact SQL, all22 site operations and runtime hashes, not a189-file overwrite',()=>{
 const a=p.decisions[0],b=p.decisions[1],c=p.decisions[2],d=p.decisions[3];
 assert.equal(a.scope.only_function,'recommendation-v2-forward-worker-v1');
 assert.equal(a.scope.worker_redeploy,false);
 assert.equal(a.scope.manual_business_invocation,false);
 assert.equal(a.scope.member_publication,false);
 assert.equal(a.scope.sdk,'2.57.4');
 assert.equal(a.local_sources.length,22);assert.equal(a.remote_sources.length,63);
 assert.equal(b.sql.length,3);
 for(const s of b.sql){assert.equal(hash(read(s.path)),s.sha256);assert.equal(s.content,read(s.path).toString());}
 assert.deepEqual(b.sql.map(s=>s.path),[
  'supabase/migrations/20261010061630_vnext_research_projection_candidate.sql',
  'supabase/migrations/20261012080628_vnext_member_publication_control_candidate.sql',
  'supabase/migrations/20261013045054_membership_legacy_policy_candidate.sql',
 ]);
 assert.equal(b.policy_activation,false);assert.equal(b.research_publication,false);
 assert.equal(b.website.operations.length,22);assert.equal(b.website.not_full_repo_overwrite,true);
 assert.equal(b.website.operations.filter(f=>f.classification==='CLIENT_UI_RUNTIME_SOURCE').length,16);
 for(const row of b.website.operations){assert.equal(hash(read(row.path)),row.target_sha256);assert.equal(row.mode,'100644');}
 assert.equal(c.rpc,'public.activate_membership_policy_candidate_v1(text)');
 assert.equal(c.not_covered_by_sql_installation,true);assert.match(c.status,/HOLD/);
 for(const f of [b.edge,...d.functions]){
  assert.match(f.entry_sha256,/^[a-f0-9]{64}$/);
  for(const s of f.sources){
   assert.match(s.sha256,/^[a-f0-9]{64}$/);
   if(!s.source.startsWith('https:'))assert.equal(hash(read(s.source)),s.sha256,s.source);
  }
 }
 for(const row of a.local_sources)assert.equal(hash(read(row.path)),row.sha256,row.path);
});

test('private receipts require strip-only recovery and no false bit-identical SDK guarantee',()=>{
 const d=p.decisions[3];
 assert.match(d.status,/HOLD/);assert.equal(d.formal_source_admission,false);
 assert.equal(d.member_publication,false);
 assert.equal(d.rollback.source_commit,'cd3e49cb6e60908346ccb04ed5c07ee5e89412ad');
 assert.equal(d.rollback.sdk,'2.115.0');
 assert.match(d.rollback.procedure,/Never restore untouchedV55/);
 assert.match(d.rollback.remaining_risk,/not bit-identical ESZIP/);
 assert.equal(d.reader_smoke.production_execution,false);
 assert.equal(p.decisions[1].functional_recovery.not_bit_identical_original_sdk_unknown,true);
 assert.equal(p.caller_fixed_sdk_recovery.binary_identity_proven,false);
 assert.equal(p.decisions[4].publication_approved,0);
 assert.equal(p.limitations.payment,'DISABLED');
});

test('review export contains no user paths, credentials, raw business objects or provider response bodies',()=>{
 const text=bytes.toString();
 assert.doesNotMatch(text,/\/Users\/|file:\/\/|Bearer\s+[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{15,}\.|postgres(?:ql)?:\/\/|[A-Z0-9._%+-]+@gmail\.com|BEGIN (?:RSA |EC )?PRIVATE KEY/i);
 for(const d of p.decisions)for(const f of d.functions??(d.edge?[d.edge]:[]))for(const n of f.sources){
  assert.deepEqual(Object.keys(n).filter(k=>!['source','sha256','source_bytes','deno_cache_file_sha256','imports'].includes(k)),[]);
  for(const s of [n.source,...(n.imports??[])]){
   if(s.startsWith('https:')){const u=new URL(s);assert.equal(u.hostname,'esm.sh');assert.equal(u.username,'');assert.equal(u.password,'');for(const k of u.searchParams.keys())assert.doesNotMatch(k,/token|secret|auth|cookie|password/i);}
   else assert.match(s,/^(?:supabase|src|shared|research)\/|^node:/);
  }
 }
 assert.equal(p.stock_evaluation.evaluated,0);assert.equal(p.stock_evaluation.blocked,72);
 assert.equal(p.stock_evaluation.not_fully_evaluated_rejection,true);
 assert.equal(p.stock_evaluation.reasons_overlap,true);
 assert.equal(p.functional_acceptance.production_changes_this_run,0);
});

test('new schedule repair is a separately named23rd operation, not silently inside old22',()=>{
 const a=p.ui_schedule_addendum;
 assert.equal(a.not_silently_in_original22,true);
 assert.equal(a.combined_operations_if_approved,23);
 assert.equal(p.decisions[1].website.operations.length,22);
 assert(!p.decisions[1].website.operations.some(f=>f.path===a.path));
 assert.equal(hash(read(a.path)),a.target_sha256);
 assert.equal(hash(before(a.path)),a.live_before_sha256);
 assert.match(a.status,/HOLD_SEPARATE_NAMED/);
 assert.equal(a.not_production_verified,true);
});

test('saved72-stock evidence gaps retain exact periods and distinguish blocking from investment rejection',()=>{
 const g=JSON.parse(read('docs/operations/evidence/v1-source-gap-detail-r8-20261017.json'));
 assert.equal(g.schema,'V1_REAL_SAVED_SOURCE_GAP_DETAIL_R8_20261017');
 assert.deepEqual(g.funnel,{universe:72,evaluated:0,blocked:72,ready:0,watch:0,none:0});
 assert.equal(g.rows.length,72);assert.equal(new Set(g.rows.map(r=>r.symbol)).size,72);
 assert.equal(g.official_capture.quarterly_eps_as_reported.period,'2026-Q2');
 assert.equal(g.official_capture.quarterly_eps_as_reported.single_quarter_basis,'UNPROVEN');
 assert.equal(g.official_capture.quarterly_eps_as_reported.original_publication_time,null);
 assert.deepEqual(g.official_capture.monthly_revenue.missing_symbols,['2881','2882','2884','2885','2891']);
 assert.equal(g.rows.filter(r=>r.source_reported_monthly_revenue_periods.length===1).length,67);
 assert.deepEqual(g.quarter_contract.sequence_relative_to_saved_2026Q2,['2025-Q3','2025-Q4','2026-Q1','2026-Q2']);
 assert.equal(g.quarter_contract.not_claim_latest_all_issuer_announcements,true);
 for(const r of g.rows){
  assert.equal(r.status,'BLOCKED');assert.equal(r.reasons.length,5);
  assert.deepEqual(r.source_reported_eps_periods,['2026-Q2']);
  assert.deepEqual(r.canonical_actual_consensus_guidance_quarters,[]);
  assert.equal(r.canonical_institutional_actual_twd_rows,0);
  assert.equal(r.classification.strategy_risk,'NOT_EVALUATED_NOT_REJECTED_FOR_INVESTMENT_VALUE');
 }
 for(const count of Object.values(g.catalog_counts))assert.equal(count,0);
});

test('bounded capability manifest binds complete SDK sources and independently held temporary scope',()=>{
 const text=read('docs/operations/evidence/v1-provider-capability-exact-manifest-r8-20261017.json').toString();
 const m=JSON.parse(text),c=m.source_and_import_closure;
 assert.equal(m.approvals.production_authorized,false);
 assert.equal(m.approvals.function_deployment_authorized,false);
 assert.equal(m.approvals.provider_requests_authorized,false);
 assert.equal(m.approvals.temporary_ui_publication_authorized,false);
 assert.equal(m.function_candidate.name,'v1-provider-capability-review-v1');
 assert.equal(m.function_candidate.verify_jwt,true);assert.equal(m.function_candidate.sdk,'2.115.0');
 assert.deepEqual(c.expected_counts,{local:3,remote:54,builtin:2,total:59});
 assert.equal(c.local_sources.length,3);assert.equal(c.remote_sources.length,54);
 for(const row of c.local_sources)assert.equal(hash(read(row.path)),row.sha256,row.path);
 for(const row of c.remote_sources){const u=new URL(row.specifier);assert.equal(u.hostname,'esm.sh');assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.equal(u.username,'');assert.equal(u.password,'');}
 assert.equal(m.fixed_provider_plan.actual_provider_calls_this_authoring_run,0);
 assert.equal(m.fixed_provider_plan.maximum_provider_requests,6);assert.equal(m.fixed_provider_plan.retries,0);
 assert.equal(m.fixed_provider_plan.request_plan.length,6);
 assert.equal(m.fixed_provider_plan.limits.whole_request_deadline_ms,15000);
 assert.equal(m.fixed_provider_plan.limits.per_provider_request_ms,2000);
 assert.equal(m.fixed_provider_plan.limits.expires_at,'2026-10-18T06:00:00Z');
 assert.equal(m.temporary_ui.runtime_operation_count,2);
 for(const row of m.temporary_ui.runtime_operations)assert.equal(hash(read(row.path)),row.target_sha256,row.path);
 assert.equal(m.temporary_ui.build_only_type_closure.new_build_only_source_count,6);
 assert.equal(m.temporary_ui.build_only_type_closure.preserve_existing_archive_source_count,3);
 assert.equal(m.strict_cleanup.wait_after_verified_function_absence_ms,15000);
 assert.equal(m.strict_cleanup.any_unexpected_object,'STOP_NO_DELETE');
 assert.doesNotMatch(text,/\/Users\/|file:\/\/|Bearer\s+[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{15,}\.|postgres(?:ql)?:\/\/|BEGIN (?:RSA |EC )?PRIVATE KEY/i);
});
