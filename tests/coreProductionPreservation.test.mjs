import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('docs/operations/core-stability-source-manifest-20260907.json',root),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const incident=JSON.parse(readFileSync(new URL('docs/operations/core-stability-incident-amendment-20260908.json',root),'utf8'));
test('trusted deployed generator/orchestrator dependencies: protected AI settings, prompts and strategy declarations remain unchanged',()=>{
  const parsed=new Map();
  assert.ok(manifest.protected_declarations.length>100);
  for(const deployment of manifest.production){
    for(const file of deployment.files){
      let bytes=readFileSync(new URL(file.path,root),'utf8');
      const amendment=incident.files.find(row=>row.path===file.path);
      if(amendment){
        assert.equal(hash(bytes),amendment.incident_sha256,`incident artifact drift: ${file.path}`);
        continue;
      }
      if(file.path==='supabase/functions/get-report-payload/index.ts'){
        // 2026-09-07 explicit read-side Evidence approval. Remove ONLY the
        // additive block to prove every pre-existing Core/Auth byte is intact.
        const extension=bytes.match(/  \/\/ Additive, read-only projection[\s\S]*?(?=\n  return jsonResponse\(\{\n    tier,\n    report_date: getReportDate\(report\))/)?.[0];
        assert.ok(extension,'approved additive block missing');
        assert.doesNotMatch(extension,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/,'read model must never write');
        bytes=bytes.replace(/import \{ loadDecisionEvidence \} from "\.\.\/_shared\/decision-v1-data.ts";\n/,'')
          .replace(/import \{ buildEvidenceDecision, projectEvidenceDecision, sealEvidenceDecision \} from "\.\.\/_shared\/decision-v1-evidence.ts";\n/,'')
          .replace('\n'+extension,'')
          .replace('    payload,\n    locked_sections: getLockedSections(tier),','    payload: buildPayload(report, tier, context),\n    locked_sections: getLockedSections(tier),');
      }
      assert.equal(hash(bytes),file.integrated_sha256,
        `integrated artifact drift: ${deployment.slug}:${file.path}`);
    }
  }
  for(const record of manifest.protected_declarations){
    if(!parsed.has(record.path)){
      const file=ts.createSourceFile(record.path,readFileSync(new URL(record.path,root),'utf8'),ts.ScriptTarget.Latest,true);
      parsed.set(record.path,new Map(file.statements.flatMap(n=>{
        const name=n.name?.getText(file)||n.declarationList?.declarations.map(d=>d.name.getText(file)).join(',');
        return name?[[name,n.getText(file)]]:[];
      })));
    }
    const text=parsed.get(record.path).get(record.name);
    assert.equal(typeof text,'string',record.path+':'+record.name);
    const amendment=incident.modified_declarations.find(row=>row.path===record.path&&row.name===record.name);
    if(amendment){
      assert.equal(amendment.production_sha256,record.production_sha256,'Original Production baseline must remain recorded');
      assert.ok(amendment.reason.length>15);
      assert.equal(hash(text),amendment.incident_sha256,record.path+':'+record.name);
    }else assert.equal(hash(text),record.production_sha256,record.path+':'+record.name);
  }
  for(const name of ['OPENAI_EVIDENCE_GUARDRAILS','OPENAI_OUTPUT_ABSTENTION_RULES','buildOpenAISystemPrompt','buildOpenAIUserPrompt','calculateV10BeneficiaryPhase1Record','V10_CANDIDATE_METADATA','calculateRepeatPenalty']){
    assert.ok(manifest.protected_declarations.some(row=>row.name===name),`required policy omitted: ${name}`);
    assert.ok(!incident.modified_declarations.some(row=>row.name===name),`AI/selection policy must not be amended: ${name}`);
  }
});
