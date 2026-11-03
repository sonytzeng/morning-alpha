/** Offline evidence audit. No network, publication, rights grants or model calls.
 * Numeric matches are necessary checks, never a substitute for content review. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {validateAnalysisPacket} from '../../research/daily-ai-analysis.ts';

const [packetPath,cardPath,outputPath,semanticsPath]=process.argv.slice(2);
if(!packetPath||!cardPath||!outputPath)throw Error('Expected packets.json cards.json output.json');
const semanticsUrl=semanticsPath?pathToFileURL(resolve(semanticsPath)):new URL('../../research/daily-ai-semantics.ts',import.meta.url);
const {validateStockAnalysisClaim,validateStockAnalysisCondition}=await import(semanticsUrl.href);
const [packetBytes,cardBytes]=await Promise.all([readFile(packetPath),readFile(cardPath)]);
const packets=JSON.parse(packetBytes),cards=JSON.parse(cardBytes);
if(!Array.isArray(packets)||!Array.isArray(cards))throw Error('AUDIT_ARRAY_REQUIRED');
const hash=b=>createHash('sha256').update(b).digest('hex');
const issues=[],checks={packets:0,cards:0,claims:0,source_bindings:0,numeric_assertions:0,numeric_matches:0};
const issue=(code,card,field,detail)=>issues.push({code,symbol:card?.symbol??null,horizon:card?.horizon??null,field,detail});
const bySymbol=new Map(packets.map(p=>[p.symbol,p]));
if(packets.length!==72||bySymbol.size!==72||cards.length!==216)issue('UNIVERSE',null,'edition','Expected 72 unique packets and 216 cards');
for(const packet of packets){try{validateAnalysisPacket(packet);checks.packets++;}catch(e){issue('PACKET',packet,'packet',e.message);}}
const cardKeys=new Set();
for(const card of cards){
 const packet=bySymbol.get(card.symbol),key=card.symbol+':'+card.horizon;
 if(!packet){issue('PACKET_MISSING',card,'card','No matching immutable input');continue;}
 if(cardKeys.has(key)||!['SHORT','MEDIUM','LONG'].includes(card.horizon)||packet.company!==card.company)
  issue('CARD_IDENTITY',card,'card','Duplicate horizon or company identity mismatch');
 cardKeys.add(key);checks.cards++;
 const evidence=new Map(packet.evidence.map(e=>[e.id,e]));
 const projectedIds=new Set((card.sources??[]).map(s=>s.id));
 if(!['WATCH','WAIT','AVOID','INSUFFICIENT'].includes(card.status))issue('CARD_STATUS',card,'status','Unknown research state');
 for(const field of ['confirmation','invalidation'])try{validateStockAnalysisCondition(card[field]);}catch(e){issue('CONDITION',card,field,e.message);}
 if(card.status==='INSUFFICIENT'&&!card.gaps?.length)issue('GAP_MISSING',card,'gaps','Insufficient decision needs an explicit gap');
 for(const source of card.sources??[]){
  const original=evidence.get(source.id);
  if(!original||['source','kind','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash'].some(k=>(source[k]??null)!==(original[k]??null)))
   issue('SOURCE_BINDING',card,'sources',source.id);
  else checks.source_bindings++;
 }
 for(const [field,claim] of [['reason',card.reason],...(card.counter_evidence??[]).map((c,i)=>['counter_evidence.'+i,c])]){
  checks.claims++;
  if(!claim||!Array.isArray(claim.evidence_ids)||!claim.evidence_ids.length||new Set(claim.evidence_ids).size!==claim.evidence_ids.length
   ||claim.evidence_ids.some(id=>!evidence.has(id))){issue('CITATION',card,field,'Missing, duplicate or unknown input citation');continue;}
  try{validateStockAnalysisClaim(packet,claim);}catch(e){issue('PERIOD_OR_FORECAST',card,field,e.message);}
  if(claim.evidence_ids.some(id=>!projectedIds.has(id)))issue('PROJECTED_CITATION_MISSING',card,field,'Member source list omits a cited input');
  const cited=claim.evidence_ids.map(id=>evidence.get(id));
  const financial=cited.filter(e=>e.kind==='FINANCIAL').flatMap(e=>{try{return [JSON.parse(e.content)];}catch{return [];}});
  const hasNews=cited.some(e=>e.kind==='NEWS');
  const patterns=[[/年(增|減)\s*([+-]?\d+(?:\.\d+)?)\s*[%％]/gu,'yoy_percent'],[/月(增|減)\s*([+-]?\d+(?:\.\d+)?)\s*[%％]/gu,'mom_percent'],
   [/(?:EPS|每股盈餘|每股獲利|基本每股盈餘)(?:來源|原報|實績|原報值|為|值|是|約|\s)*([負-]?\d+(?:\.\d+)?)/giu,'value'],
   [/本益比(?:為|約|\s)*([+-]?\d+(?:\.\d+)?)\s*倍/gu,'pe_ratio'],[/股價淨值比(?:為|約|\s)*([+-]?\d+(?:\.\d+)?)\s*倍/gu,'pb_ratio']];
  for(const [pattern,metric] of patterns)for(const match of claim.text.matchAll(pattern)){
   const isGrowth=metric==='yoy_percent'||metric==='mom_percent',raw=isGrowth?match[2]:match[1];
   const value=Number(raw.replace('負','-'))*(isGrowth&&match[1]==='減'?-1:1),decimals=raw.split('.')[1]?.length??0;
   const tolerance=.5*10**(-decimals)+1e-9;
   const observed=financial.filter(f=>metric!=='value'||f.kind==='EPS_AS_REPORTED'||f.kind==='EPS').map(f=>f.values?.[metric]).filter(v=>typeof v==='number'&&Number.isFinite(v));
   checks.numeric_assertions++;
   if(observed.some(v=>Math.abs(v-value)<=tolerance))checks.numeric_matches++;
   else issue(hasNews?'NUMERIC_NEWS_REVIEW_REQUIRED':'NUMERIC_MISMATCH',card,field,{metric,asserted:value,cited_values:observed,phrase:match[0]});
  }
 }
}
for(const symbol of bySymbol.keys())for(const horizon of ['SHORT','MEDIUM','LONG'])if(!cardKeys.has(symbol+':'+horizon))issue('HORIZON_MISSING',{symbol,horizon},'card','Missing horizon');
const report={schema:'DAILY_AI_OFFLINE_EDITION_AUDIT_V1',recorded_at:new Date().toISOString(),
 input_hashes:{packets:hash(packetBytes),cards:hash(cardBytes),semantics:hash(await readFile(semanticsUrl))},checks,issues,
 status:issues.length?'REVIEW_REQUIRED':'MECHANICAL_CHECKS_PASS_CONTENT_REVIEW_REQUIRED',
 limitations:['Numeric matching does not establish metric-to-period semantics, completeness, causation or investment value.',
 'News numeric assertions require separate reading of the cited primary text.',
 'No legal/use-rights, pricing, performance, subscription or production-read acceptance is claimed.'],
 model_calls:0,production_writes:0,member_published:false};
await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,checks,issue_counts:Object.fromEntries([...new Set(issues.map(i=>i.code))].map(k=>[k,issues.filter(i=>i.code===k).length]))}));
