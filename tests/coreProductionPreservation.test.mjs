import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('docs/operations/core-stability-source-manifest-20260907.json',root),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
test('trusted deployed generator/orchestrator dependencies: protected AI settings, prompts and strategy declarations remain unchanged',()=>{
  const parsed=new Map();
  assert.ok(manifest.protected_declarations.length>100);
  for(const deployment of manifest.production){
    for(const file of deployment.files){
      assert.equal(hash(readFileSync(new URL(file.path,root),'utf8')),file.integrated_sha256,
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
    assert.equal(hash(text),record.production_sha256,record.path+':'+record.name);
  }
  for(const name of ['OPENAI_EVIDENCE_GUARDRAILS','OPENAI_OUTPUT_ABSTENTION_RULES','buildOpenAISystemPrompt','buildOpenAIUserPrompt','calculateV10BeneficiaryPhase1Record','V10_CANDIDATE_METADATA','calculateRepeatPenalty']){
    assert.ok(manifest.protected_declarations.some(row=>row.name===name),`required policy omitted: ${name}`);
  }
});
