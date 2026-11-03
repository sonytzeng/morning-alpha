/** node --experimental-strip-types scripts/vnext/issuer-quarter-observations.mjs
 * manifest.json prior-private-review.json new-private-review.json
 * Offline only. Requires pdftotext; never accepts caller-supplied extracted text. */
import {readFileSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseIssuerQuarterText,withIssuerQuarterObservations} from '../../research/issuer-quarter-observations.ts';
import {evaluateResearch} from '../../src/features/vnext/researchFunnel.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function readIssuerObservations(manifestPath,cutoff){
 const root=dirname(realpathSync(manifestPath)),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(manifest.schema!=='RETAINED_ISSUER_PDF_INPUTS_V1'||!Array.isArray(manifest.documents)||manifest.documents.length>48)throw Error('ISSUER_MANIFEST_INVALID');
 const local=name=>{if(typeof name!=='string'||isAbsolute(name))throw Error('ISSUER_FILE_SCOPE');const path=realpathSync(resolve(root,name)),rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('ISSUER_FILE_SCOPE');return path;};
 const observations=[],documents=[];
 for(const item of manifest.documents){
  const path=local(item.pdf),raw=readFileSync(path),receipt=JSON.parse(readFileSync(local(item.receipt),'utf8'));
  if(raw.length>8_000_000||raw.subarray(0,5).toString()!=='%PDF-'||receipt.status!==200||receipt.url!==receipt.final_url
   ||receipt.bytes!==raw.length||receipt.sha256!==sha(raw))throw Error('ISSUER_PDF_RECEIPT_MISMATCH');
  const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8',maxBuffer:8_000_000,timeout:20000});
  const d={symbol:item.symbol,period:item.period,format:item.format,source:receipt.url,sha256:receipt.sha256,bytes:raw.length,received_at:receipt.received_at,text};
  observations.push(...await parseIssuerQuarterText(d,cutoff));
  documents.push({...item,source:d.source,sha256:d.sha256,bytes:d.bytes,received_at:d.received_at,extracted_text_sha256:sha(text)});
 }
 const ids=observations.map(f=>f.id);if(new Set(ids).size!==ids.length)throw Error('ISSUER_DUPLICATE_DOCUMENT');
 return {documents,observations};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const [manifestPath,priorPath,outputPath]=process.argv.slice(2);if(!manifestPath||!priorPath||!outputPath||existsSync(outputPath))throw Error('NEW_OUTPUT_AND_THREE_PATHS_REQUIRED');
 globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
 const cutoff=new Date().toISOString(),priorBytes=readFileSync(priorPath),prior=JSON.parse(priorBytes),pack=await readIssuerObservations(manifestPath,cutoff);
 if(!Array.isArray(prior.inputs)||prior.inputs.length!==72||new Set(prior.inputs.map(i=>i.symbol)).size!==72)throw Error('ISSUER_STUDY_UNIVERSE_INVALID');
 const inputs=prior.inputs.map(input=>withIssuerQuarterObservations({...input,cutoff},pack.observations));
 const evaluations=inputs.flatMap(input=>['SHORT','MEDIUM','LONG'].map(h=>evaluateResearch(input,h)));
 const counts=Object.fromEntries(['SHORT','MEDIUM','LONG'].map(h=>[h,Object.fromEntries(['QUALIFIED','REJECTED','INSUFFICIENT'].map(s=>[s,evaluations.filter(e=>e.horizon===h&&e.state===s).length]))]));
 const summary={schema:'OWNER_ISSUER_QUARTER_OBSERVATION_REVIEW_V1',created_at:cutoff,source_review_sha256:sha(priorBytes),
  scope:'PRIVATE_RESEARCH_OBSERVATIONS_NOT_RECOMMENDATIONS',added_documents:pack.documents.length,added_facts:pack.observations.length,
  symbols:[...new Set(pack.observations.map(f=>f.symbol))].sort(),capex_added:0,counts,
  missing:['DIRECT_SINGLE_QUARTER_CAPEX','CURRENT_COMPANY_EVENT_REVIEW','SOURCE_PUBLICATION_TIME_AND_RIGHTS','INDEPENDENT_METHOD_AND_QUALITY_REVIEW'],
  methodology_promoted:false,source_admitted:false,member_publications:0,forward_samples:0,production_writes:0};
 writeFileSync(outputPath,JSON.stringify({summary,...pack,inputs,evaluations}),{flag:'wx'});
 if(sha(readFileSync(priorPath))!==summary.source_review_sha256)throw Error('PRIOR_STUDY_CHANGED');
 console.log(JSON.stringify(summary,null,2));
}
