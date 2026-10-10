/** Publication preparation only. This is NOT an approval or member read API. */
import {HORIZONS,sourceSafe,hashValid,type Horizon} from './contracts.ts';
import {researchCard,factIssues,type RealStock} from './realResearch.ts';
import {validProjectionTime} from './projection.ts';

export const RIGHTS_REVIEW_VERSION='VNEXT_RIGHTS_20261010_1';
export type SourceRights={
 id:string;title:string;dataset:string;resource:string;api:string;license:string;attribution:string;
};
// Exact dataset/resource mapping, independently checked against data.gov.tw and
// both exchanges' Swagger. A hostname or an API subscription is NOT a license.
export const OPEN_DATA_RIGHTS:readonly SourceRights[]=[
 {id:'18415',title:'上市公司每日重大訊息',code:'t187ap04_L',exchange:'TWSE'},
 {id:'18418',title:'上櫃公司每日重大訊息',code:'t187ap04_O',exchange:'TPEX'},
 {id:'18420',title:'上市公司每月營業收入彙總表',code:'t187ap05_L',exchange:'TWSE'},
 {id:'56510',title:'上櫃公司每月營業收入彙總表',code:'t187ap05_O',exchange:'TPEX'},
 {id:'20756',title:'上市公司各產業EPS統計資訊',code:'t187ap14_L',exchange:'TWSE'},
 {id:'20757',title:'上櫃公司各產業EPS統計資訊',code:'t187ap14_O',exchange:'TPEX'},
].map(r=>({id:r.id,title:r.title,dataset:`https://data.gov.tw/dataset/${r.id}`,
 resource:`https://mopsfin.twse.com.tw/opendata/${r.code}.csv`,
 api:r.exchange==='TWSE'?`https://openapi.twse.com.tw/v1/opendata/${r.code}`:`https://www.tpex.org.tw/openapi/v1/mopsfin_${r.code}`,
 license:'https://data.gov.tw/license',attribution:`資料來源：金融監督管理委員會證券期貨局／${r.exchange==='TWSE'?'臺灣證券交易所':'證券櫃檯買賣中心'}，${r.title}；政府資料開放授權條款第1版。` }));

export function sourceRights(source:string){
 const grant=OPEN_DATA_RIGHTS.find(r=>source===r.resource||source===r.api);
 if(grant)return {status:'OPEN_DATA_WITH_ATTRIBUTION' as const,grant,reason:'指定資料集可依授權及來源標示使用；不代表研究已通過發布審查。'};
 if(!sourceSafe(source))return {status:'LICENSING_UNVERIFIED' as const,grant:null,reason:'來源無法安全核對，不能公開。'};
 const host=new URL(source).hostname;
 if(host==='api.fugle.tw'||host.endsWith('.fugle.tw'))return {status:'RESTRICTED_CONTRACT_REQUIRED' as const,grant:null,reason:'行情訂閱不等於第三方再散布許可，仍需核對實際商用合約。'};
 if(host==='pr.tsmc.com'||host==='www.tsmc.com')return {status:'LICENSING_UNVERIFIED' as const,grant:null,reason:'官網可讀不代表文字、圖像及衍生成品可供會員使用；目前未取得適用授權。'};
 return {status:'LICENSING_UNVERIFIED' as const,grant:null,reason:'未證明此精確來源與用途的授權，不以同網域的開放資料授權替代。'};
}

export function publicationDossier(stock:RealStock,cutoff:string){
 if(!validProjectionTime(cutoff)||!/^\d{4,6}$/.test(stock.symbol)||!stock.company
  ||new Set(stock.facts.map(f=>f.id)).size!==stock.facts.length||stock.facts.some(f=>f.symbol!==stock.symbol))throw Error('DOSSIER_INPUT_INVALID');
 return (Object.keys(HORIZONS) as Horizon[]).map(horizon=>{
  const card=researchCard(stock,horizon,cutoff);
  // Audit ALL inputs, including missing/future timestamps rejected by rendering.
  // Rejected evidence must not disappear from the publication audit.
  const facts=stock.facts.filter(f=>(HORIZONS[horizon].required as readonly string[]).includes(f.kind));
  const rights=facts.map(f=>({id:f.id,source:f.source,...sourceRights(f.source)}));
  const evidence_issues=facts.flatMap(f=>factIssues(f,cutoff).map(reason=>({id:f.id,reason})));
  const missing=HORIZONS[horizon].required.filter(k=>!facts.some(f=>f.kind===k&&factIssues(f,cutoff).length===0));
  const blockers=[...missing.map(k=>'MISSING_'+k),...rights.filter(r=>r.status!=='OPEN_DATA_WITH_ATTRIBUTION').map(r=>r.status),
   ...evidence_issues.map(r=>r.reason),'PUBLICATION_REVIEW_REQUIRED','PREDICTION_NOT_CREATED'];
  return {...card,cutoff,mode:'REVIEW_DOSSIER_NOT_PREDICTION' as const,member_eligible:false as const,
   evidence_ready:missing.length===0&&evidence_issues.length===0&&rights.length>0&&rights.every(r=>r.status==='OPEN_DATA_WITH_ATTRIBUTION'),
   blockers:[...new Set(blockers)].sort(),rights,evidence_issues};
 });
}
export type PublicationDossier=ReturnType<typeof publicationDossier>[number];
export type PublicationReadiness={
 schema:'VNEXT_PUBLICATION_READINESS_V1';mode:'OWNER_REVIEW_ONLY';audited_at:string;through:string;
 history_hash:string;sources_hash:string;universe:number;cards:PublicationDossier[];
 eligible:Record<Horizon,number>;source_rights:ReturnType<typeof sourceRights>[];
 forward_sample:0;outcome_sample:0;member_publication:false;natural_update_enabled:false;
};
export function validPublicationReadiness(x:PublicationReadiness):boolean{
 return x?.schema==='VNEXT_PUBLICATION_READINESS_V1'&&x.mode==='OWNER_REVIEW_ONLY'&&validProjectionTime(x.audited_at)
  &&/^\d{4}-\d\d-\d\d$/.test(x.through)&&hashValid(x.history_hash)&&hashValid(x.sources_hash)&&x.universe===72
  &&x.cards.length===216&&new Set(x.cards.map(c=>c.symbol+':'+c.horizon)).size===216
  &&(Object.keys(HORIZONS) as Horizon[]).every(h=>x.cards.filter(c=>c.horizon===h).length===72&&x.eligible[h]===0)
  &&x.cards.every(c=>c.member_eligible===false&&c.mode==='REVIEW_DOSSIER_NOT_PREDICTION'&&c.blockers.length>0)
  &&x.forward_sample===0&&x.outcome_sample===0&&x.member_publication===false&&x.natural_update_enabled===false;
}
