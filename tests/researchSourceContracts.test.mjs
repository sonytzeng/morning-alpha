import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from 'typescript';

const BASE='588e83f3012a31469d5c58b6874ec49c98a2e4b9';
const DTO='src/types/research-source-contracts.ts',FIXTURE='tests/researchSourceContracts.types.ts';
const CONSUMERS=Object.freeze(['src/features/decision-v1/contract.ts','src/features/research/tradingLab.ts','src/features/research/cockpit.ts',
 'src/pages/admin/analysis/EntryOpportunity.tsx','src/pages/admin/analysis/OwnerCockpit.tsx']);
const config=ts.readConfigFile('tsconfig.app.json',ts.sys.readFile);assert.equal(config.error,undefined);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());assert.deepEqual(parsed.errors,[]);
const options={...parsed.options,noEmit:true,incremental:false,tsBuildInfoFile:undefined,strictNullChecks:true,types:[]};
function diagnostics(dto=readFileSync(DTO,'utf8')){
 const host=ts.createCompilerHost(options),nativeRead=host.readFile;
 host.readFile=path=>resolve(path)===resolve(DTO)?dto:nativeRead(path);
 const program=ts.createProgram([FIXTURE],options,host);
 return ts.getPreEmitDiagnostics(program);
}
const describe=errors=>ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'});
test('frontend DTOs exactly match all complete actual backend types in both directions with strict nullability',()=>{
 const errors=diagnostics();assert.equal(errors.length,0,describe(errors));
});
test('real type comparisons reject schema widening, narrowing, null, tuple, readonly and optional drift',()=>{
 const source=readFileSync(DTO,'utf8');
 const fixture=ts.createSourceFile(FIXTURE,readFileSync(FIXTURE,'utf8'),ts.ScriptTarget.Latest,true);
 for(const [label,comparison,before,after] of [
  ['strategy union','StrategyEquality',"'OVERSOLD_REVERSAL'|'PULLBACK_ENTRY'|'BREAKOUT_CONTINUATION'","'OVERSOLD_REVERSAL'|'PULLBACK_ENTRY'|'BREAKOUT_CONTINUATION'|'UNREVIEWED'"],
  ['wire boolean narrowing','EntryEvaluationEquality','owner_only:boolean','owner_only:true'],
  ['null removal','EntryResultEquality','name:string|null','name:string'],
  ['policy literal widening','EntryEvaluationEquality','minAmount:50000000','minAmount:number'],
  ['tuple widening','EntryResultEquality','reference_range:[number,number]','reference_range:number[]'],
  ['readonly removal','EntryResultEquality','horizons:readonly number[]','horizons:number[]'],
  ['optional field removal','PhaseEquality','relative_strength?:boolean;',''],
  ['performance branch widening','PerformanceEquality','{win_rate:null;average_win:null;','{win_rate:number|null;average_win:null;'],
 ]){
  const alias=fixture.statements.find(statement=>ts.isTypeAliasDeclaration(statement)&&statement.name.text===comparison);
  assert(alias,label+' binds a named actual backend comparison');
  assert(source.includes(before),label+' mutation target');const errors=diagnostics(source.replace(before,after));
  assert(errors.some(error=>error.file?.fileName.endsWith(FIXTURE)&&error.code===2344&&error.start>=alias.pos&&error.start<alias.end),
   label+' must fail its actual backend equality, not an unrelated negative assertion: '+describe(errors));
 }
});
test('the five type-only consumer changes emit byte-identical JavaScript to the immutable baseline',()=>{
 for(const path of CONSUMERS){
  const before=execFileSync('git',['--no-replace-objects','show',BASE+':'+path],{maxBuffer:1024*1024}).toString();
  const after=readFileSync(path,'utf8');assert.notEqual(after,before,path+' has a reviewed type-only replacement');
  const emit=source=>ts.transpileModule(source,{fileName:path,compilerOptions:{...parsed.options,noEmit:false,incremental:false,sourceMap:false,inlineSourceMap:false}}).outputText;
  assert.equal(emit(after),emit(before),path+' runtime output changed');
 }
});
test('frontend research DTO and replacement imports contain types only and do not reach protected backend paths',()=>{
 const file=ts.createSourceFile(DTO,readFileSync(DTO,'utf8'),ts.ScriptTarget.Latest,true);
 for(const statement of file.statements){
  assert(ts.isTypeAliasDeclaration(statement)||ts.isInterfaceDeclaration(statement)||ts.isImportDeclaration(statement),'DTO contains executable statement');
  if(ts.isImportDeclaration(statement)){
   assert.equal(statement.importClause?.isTypeOnly,true);assert.equal(statement.moduleSpecifier.text,'../features/decision-v1/contract');
  }
 }
 for(const path of CONSUMERS){
  const file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  let imported=false;
  for(const statement of file.statements)if(ts.isImportDeclaration(statement)&&String(statement.moduleSpecifier.text).endsWith('types/research-source-contracts')){
   assert.equal(statement.importClause?.isTypeOnly,true);imported=true;
  }
  assert(imported,path+' imports its frontend contract');
  assert.doesNotMatch(readFileSync(path,'utf8'),/(?:import|from)\s*\(?['"][^'"]*(?:supabase\/functions|research\/entry-opportunity)/,path);
 }
});
