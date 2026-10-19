import process from 'node:process';
import console from 'node:console';
// Supplementary strict TypeScript check; actual Deno remains a separate CI check.
import ts from 'typescript';import assert from 'node:assert/strict';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {readReleaseCatalog} from './materialize.mjs';
assert.equal(process.argv.length,2,'QUARTER_TYPESCRIPT_NO_ARGUMENTS');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),catalog=readReleaseCatalog(),base=path.join(root,'build/owner-quarter-live-typecheck'),results=[];
const options={strict:true,noEmit:true,allowImportingTsExtensions:true,resolveJsonModule:true,allowSyntheticDefaultImports:true,allowJs:true,checkJs:false,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,target:ts.ScriptTarget.ES2022,types:[],lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']};
for(const variant of ['producer','producer-recovery','reader','reader-recovery']){
 const sourceRoot=path.join(base,variant),entry=path.join(sourceRoot,'supabase/functions',variant.startsWith('producer')?'recommendation-stock-evidence-v1':'get-report-payload','index.ts');
 const node=path.join(sourceRoot,'supabase/functions/_shared/_owner_quarter_types/node/index.d.ts'),undici=path.join(sourceRoot,'supabase/functions/_shared/_owner_quarter_types/undici-types/index.d.ts');
 const host=ts.createCompilerHost(options),surface=path.join(sourceRoot,'__compiler_only_deno_surface.d.ts'),source="declare namespace Deno { const env: {get(name:string):string|undefined}; function serve(handler:(request:Request)=>Response|Promise<Response>):void; }\n",getSourceFile=host.getSourceFile.bind(host);
 host.getSourceFile=(name,...rest)=>name===surface?ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true):getSourceFile(name,...rest);host.resolveModuleNames=(names,from)=>names.map(name=>name==='undici-types'?{resolvedFileName:undici,extension:ts.Extension.Dts}:ts.resolveModuleName(name,from,options,host).resolvedModule);
 host.resolveTypeReferenceDirectives=names=>names.map(input=>{const name=typeof input==='string'?input:input.fileName;if(name!=='node')throw Error('UNSEALED_TYPE_REFERENCE:'+name);return{resolvedFileName:node,primary:true};});
 const program=ts.createProgram([entry,surface],options,host),ds=ts.getPreEmitDiagnostics(program);
 if(ds.length)process.stderr.write(ts.formatDiagnosticsWithColorAndContext(ds,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 results.push({variant,diagnostics:ds.length,codes:[...new Set(ds.map(d=>d.code))],source_files:program.getSourceFiles().length,external_node_modules_types:program.getSourceFiles().filter(f=>f.fileName.includes('/node_modules/')&&!f.fileName.includes('/typescript/lib/')).map(f=>f.fileName)});
}
assert.equal(catalog.production_authorized,false);
const report={scope:'STRICT_TYPESCRIPT_ACTUAL_MATERIALIZED_ENTRIES_WITH_TRUE_ARCHIVED_DECLARATIONS_NOT_DENO',results};console.info(JSON.stringify(report));process.exitCode=results.some(r=>r.diagnostics||r.external_node_modules_types.length)?1:0;
