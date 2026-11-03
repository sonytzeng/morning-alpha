// Node22.14-compatible isolated ESM namespace; no current/remote source fallback.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {STOCK_AI_HISTORICAL_SCHEME,stockAiHistoricalPath,normalizeStockAiHistoricalUrl,readStockAiHistoricalUrl,stockAiHistoricalBuiltinAllowed,stockAiHistoricalEntryAllowed} from './stockAiHistoricalProtocol.mjs';

export async function resolve(specifier,context,nextResolve){
 if(specifier.startsWith(STOCK_AI_HISTORICAL_SCHEME)){
  if(context.parentURL?.startsWith(STOCK_AI_HISTORICAL_SCHEME))assert.equal(new URL(specifier).hostname,new URL(context.parentURL).hostname,'STOCK_AI_HISTORY_CROSS_REVISION_IMPORT');
  else assert(stockAiHistoricalEntryAllowed(specifier),'STOCK_AI_HISTORY_ENTRYPOINT');
  return {url:normalizeStockAiHistoricalUrl(specifier),shortCircuit:true};
 }
 if(context.parentURL?.startsWith(STOCK_AI_HISTORICAL_SCHEME)){
  if(specifier.startsWith('.'))return {url:normalizeStockAiHistoricalUrl(new URL(specifier,context.parentURL).href),shortCircuit:true};
  assert(stockAiHistoricalBuiltinAllowed(context.parentURL,specifier),'STOCK_AI_HISTORY_NONLOCAL_IMPORT:'+specifier);
 }
 return nextResolve(specifier,context);
}
export async function load(url,context,nextLoad){
 if(!url.startsWith(STOCK_AI_HISTORICAL_SCHEME))return nextLoad(url,context);
 const path=stockAiHistoricalPath(url),bytes=readStockAiHistoricalUrl(url),source=bytes.toString('utf8');
 assert(bytes.equals(Buffer.from(source)),'STOCK_AI_HISTORY_UTF8');
 if(path.endsWith('.json'))return {format:'json',source,shortCircuit:true};
 assert(/\.(?:ts|mjs)$/.test(path),'STOCK_AI_HISTORY_SOURCE_EXTENSION');
 const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},fileName:path,reportDiagnostics:true});
 assert.equal(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length??0,0,'STOCK_AI_HISTORY_TRANSPILE');
 return {format:'module',source:result.outputText,shortCircuit:true};
}
