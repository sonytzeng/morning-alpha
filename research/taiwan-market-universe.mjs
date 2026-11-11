/** Full-market identity and bounded work planning. Official company rosters
 * determine scope; a selected stock list never substitutes for the universe. */
import {createHash} from 'node:crypto';

export const TAIWAN_MARKETS=Object.freeze(['TWSE','TPEX','EMERGING']);
export const TAIWAN_COMPANY_SOURCES=Object.freeze({
 twse_companies:{market:'TWSE',url:'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',format:'json'},
 tpex_companies:{market:'TPEX',url:'https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv',format:'csv'},
 emerging_companies:{market:'EMERGING',url:'https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv',format:'csv'},
});
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(order(value));
function order(value){if(Array.isArray(value))return value.map(order);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,order(value[k])]));return value;}
const fail=code=>{throw Error('TAIWAN_MARKET_'+code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const time=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
const text=(v,max=200)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():fail('COMPANY_FIELD');
export const marketSnapshotHash=value=>sha(canonical(value));

/** Strict RFC4180-style reader, including embedded newlines and escaped quotes. */
export function parseOfficialCompanyCsv(value){
 if(typeof value!=='string'||value.length>8_000_000)fail('CSV_SIZE');
 const input=value.replace(/^\uFEFF/,''),rows=[];let row=[],field='',quoted=false,closed=false;
 const finishField=()=>{row.push(field);field='';closed=false;};
 const finishRow=()=>{finishField();if(row.some(x=>x!==''))rows.push(row);row=[];};
 for(let i=0;i<input.length;i++){const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)fail('CSV_QUOTE');quoted=true;}
  else if(c===',')finishField();
  else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;finishRow();}
  else{if(closed)fail('CSV_TRAILING_DATA');field+=c;}
 }
 if(quoted)fail('CSV_UNCLOSED_QUOTE');if(field||closed||row.length)finishRow();
 const headers=rows.shift();if(!headers||new Set(headers).size!==headers.length||headers.some(h=>!h.trim()))fail('CSV_HEADERS');
 return rows.map(r=>{if(r.length!==headers.length)fail('CSV_ROW_WIDTH');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}

export function officialDate(value){
 const raw=String(value??'').trim();let year,month,day;
 if(/^\d{7}$/.test(raw)){year=Number(raw.slice(0,3))+1911;month=Number(raw.slice(3,5));day=Number(raw.slice(5));}
 else if(/^\d{8}$/.test(raw)){year=Number(raw.slice(0,4));month=Number(raw.slice(4,6));day=Number(raw.slice(6));}
 else if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){[year,month,day]=raw.split('-').map(Number);}
 else if(/^\d{3,4}\/\d{1,2}\/\d{1,2}$/.test(raw)){const parts=raw.split('/');[year,month,day]=parts.map(Number);if(parts[0].length===3)year+=1911;}
 else fail('SOURCE_DATE');
 const date=new Date(Date.UTC(year,month-1,day));
 if(year<1912||year>2200||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)fail('SOURCE_DATE');
 return date.toISOString().slice(0,10);
}
const taipeiDate=instant=>new Date(Date.parse(instant)+8*3600_000).toISOString().slice(0,10);

export function normalizeOfficialCompanyCapture({receipt,bytes}){
 const spec=TAIWAN_COMPANY_SOURCES[receipt?.source_id];
 if(!spec||receipt.schema!=='TAIWAN_PUBLIC_SOURCE_RECEIPT_V1'||receipt.state!=='CAPTURED'||receipt.status!==200
  ||receipt.url!==spec.url||receipt.format!==spec.format||!time(receipt.started_at)||!time(receipt.received_at)
  ||Date.parse(receipt.started_at)>Date.parse(receipt.received_at)||!Number.isSafeInteger(receipt.bytes)
  ||receipt.bytes<1||receipt.bytes>8_000_000||!Buffer.isBuffer(bytes)||bytes.length!==receipt.bytes||sha(bytes)!==receipt.sha256)fail('SOURCE_RECEIPT');
 let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('SOURCE_ENCODING');}
 let rows;try{rows=spec.format==='json'?JSON.parse(decoded.replace(/^\uFEFF/,'')):parseOfficialCompanyCsv(decoded);}catch{fail('SOURCE_PARSE');}
 if(!Array.isArray(rows)||rows.length<1||rows.length>10_000||receipt.row_count!==rows.length)fail('SOURCE_ROWS');
 const seen=new Set(),dates=new Set(),companies=[];
 for(const raw of rows){if(!object(raw))fail('COMPANY_ROW');
  const symbol=text(raw['公司代號'],6);if(!/^\d{4,6}$/.test(symbol)||seen.has(symbol))fail('COMPANY_IDENTITY');seen.add(symbol);
  const source_as_of=officialDate(raw['出表日期']);if(source_as_of>taipeiDate(receipt.received_at))fail('SOURCE_FUTURE_DATE');dates.add(source_as_of);
  const listing=raw[spec.market==='TPEX'?'上櫃日期':'上市日期'];
  const listed_at=listing&&String(listing).trim()?officialDate(listing):null;
  const sharesText=String(raw['已發行普通股數或TDR原股發行股數']??'').trim().replaceAll(',','');
  const shares=/^\d+$/.test(sharesText)&&Number.isSafeInteger(Number(sharesText))?Number(sharesText):null;
  companies.push({security_id:spec.market+':'+symbol,symbol,market:spec.market,company:text(raw['公司名稱']),
   short_name:text(raw['公司簡稱']),industry_code:text(raw['產業別'],20),listed_at,
   issuer_country_as_reported:String(raw['外國企業註冊地國']??'').trim()||null,
   instrument_kind:symbol.length===4?'ORDINARY_COMPANY_EQUITY':symbol.startsWith('91')?'TDR':'REQUIRES_SECURITY_CLASSIFICATION',
   common_shares_or_tdr_underlying_as_reported:shares,source_as_of,source_id:receipt.source_id,source_row_hash:marketSnapshotHash(raw),
   listing_status:listed_at&&listed_at>source_as_of?'LISTING_DATE_AFTER_SOURCE_DATE':'IN_OFFICIAL_COMPANY_ROSTER',
   price_availability:'NOT_INFERRED_FROM_ROSTER'});
 }
 if(dates.size!==1)fail('ROSTER_MIXED_DATES');
 const body={schema:'TAIWAN_OFFICIAL_COMPANY_ROSTER_V1',market:spec.market,source_id:receipt.source_id,source_url:spec.url,
  source_sha256:receipt.sha256,source_bytes:receipt.bytes,received_at:receipt.received_at,source_as_of:[...dates][0],
  source_row_count:rows.length,company_count:companies.length,companies:companies.sort((a,b)=>a.symbol.localeCompare(b.symbol)),
  license_reference:'https://data.gov.tw/license',publication_time_known:false,historical_membership_established:false};
 return {...body,roster_hash:marketSnapshotHash(body)};
}

export function buildTaiwanMarketUniverse({rosters,formed_at}){
 if(!time(formed_at)||!Array.isArray(rosters)||rosters.length!==3)fail('UNIVERSE_SCOPE');
 const markets=new Set(),identities=new Set(),companies=[],sources=[];
 for(const roster of rosters){const {roster_hash,...body}=roster??{};
  if(roster?.schema!=='TAIWAN_OFFICIAL_COMPANY_ROSTER_V1'||marketSnapshotHash(body)!==roster_hash||!TAIWAN_MARKETS.includes(roster.market)
   ||markets.has(roster.market)||Date.parse(roster.received_at)>Date.parse(formed_at)||roster.company_count!==roster.companies.length)fail('ROSTER_BINDING');
  markets.add(roster.market);sources.push({market:roster.market,source_id:roster.source_id,source_url:roster.source_url,
   source_sha256:roster.source_sha256,source_bytes:roster.source_bytes,received_at:roster.received_at,source_as_of:roster.source_as_of,
   roster_hash,company_count:roster.company_count});
  for(const c of roster.companies){if(c.market!==roster.market||identities.has(c.security_id))fail('UNIVERSE_DUPLICATE');identities.add(c.security_id);companies.push(c);}
 }
 companies.sort((a,b)=>a.security_id.localeCompare(b.security_id));
 const bySymbol=new Map();for(const c of companies){const ids=bySymbol.get(c.symbol)??[];ids.push(c.security_id);bySymbol.set(c.symbol,ids);}
 const cross_market_conflicts=[...bySymbol].filter(([,ids])=>ids.length>1).map(([symbol,security_ids])=>({symbol,security_ids}));
 const body={schema:'TAIWAN_MARKET_UNIVERSE_V1',scope:'ALL_OFFICIAL_LISTED_OTC_EMERGING_COMPANY_EQUITIES',formed_at,
  total:companies.length,counts:Object.fromEntries(TAIWAN_MARKETS.map(m=>[m,companies.filter(c=>c.market===m).length])),
  sources:sources.sort((a,b)=>a.market.localeCompare(b.market)),companies,cross_market_conflicts,
  coverage_complete:markets.size===3&&cross_market_conflicts.length===0,
  historical_membership_established:false,security_recommendations:0};
 return {...body,universe_hash:marketSnapshotHash(body)};
}

export function planTaiwanMarketAnalysis({universe,business_date,cutoff,shard_size=64}){
 const {universe_hash,...body}=universe??{};
 if(universe?.schema!=='TAIWAN_MARKET_UNIVERSE_V1'||marketSnapshotHash(body)!==universe_hash||!universe.coverage_complete
  ||!time(cutoff)||Date.parse(cutoff)<Date.parse(universe.formed_at)||officialDate(business_date)!==taipeiDate(cutoff)
  ||!Number.isInteger(shard_size)||shard_size<1||shard_size>128)fail('PLAN_SCOPE');
 const shards=[];
 for(let i=0;i<universe.companies.length;i+=shard_size){const security_ids=universe.companies.slice(i,i+shard_size).map(c=>c.security_id);
  const part={schema:'DAILY_AI_MARKET_SHARD_V2',universe_hash,business_date,cutoff,index:shards.length,security_ids,horizons:['SHORT','MEDIUM','LONG']};
  shards.push({...part,shard_id:marketSnapshotHash(part),expected_cards:security_ids.length*3});
 }
 const result={schema:'DAILY_AI_MARKET_WORK_PLAN_V2',universe_hash,business_date,cutoff,scope:universe.scope,
  securities:universe.total,expected_cards:universe.total*3,markets:universe.counts,shard_size,shards,
  acquisition_policy:'ONE_SHARED_CAPTURE_PER_OFFICIAL_DATASET_NOT_PER_STOCK',
  missing_data_policy:'KEEP_SECURITY_AND_REPORT_PERIOD_SPECIFIC_MISSING_EVIDENCE',
  member_published:false,methodology_approved:false};
 return {...result,plan_hash:marketSnapshotHash(result)};
}

export function verifyTaiwanMarketCompletion(plan,results){
 const {plan_hash,...body}=plan??{};
 if(plan?.schema!=='DAILY_AI_MARKET_WORK_PLAN_V2'||marketSnapshotHash(body)!==plan_hash||!Array.isArray(results))fail('COMPLETION_SCOPE');
 const expected=new Map(plan.shards.map(s=>[s.shard_id,s])),seen=new Set(),covered=new Set();let scanned=0;
 for(const result of results){const shard=expected.get(result?.shard_id);
  if(!shard||seen.has(result.shard_id)||!Array.isArray(result.cards)||result.cards.length!==shard.expected_cards)fail('SHARD_COMPLETION');seen.add(result.shard_id);
  const keys=new Set(shard.security_ids.flatMap(id=>shard.horizons.map(h=>id+':'+h)));
  for(const card of result.cards){const key=card.security_id+':'+card.horizon;
   if(!keys.delete(key)||covered.has(key)||!['WATCH','WAIT','AVOID','INSUFFICIENT'].includes(card.status))fail('CARD_COMPLETION');covered.add(key);scanned++;
  }
 }
 return {state:seen.size===expected.size?'ALL_SECURITIES_ANALYZED':'PARTIAL_ANALYSIS',shards_completed:seen.size,shards_expected:expected.size,
  cards_analyzed:scanned,cards_expected:plan.expected_cards,unprocessed_shards:[...expected.keys()].filter(k=>!seen.has(k)),
  analyzed_does_not_mean_recommended:true,member_published:false};
}
