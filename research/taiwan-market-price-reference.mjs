/** Lossless sharing of repeated peer inputs. A whole-market edition stores each
 * raw capture / annual-quality object once, while every reference stays hash-bound. */
import {marketSnapshotHash} from './taiwan-market-universe.mjs';
const fail=code=>{throw Error('TAIWAN_PRICE_REFERENCE_'+code);};
const keys=new Set(['source_capture','source_captures','issuer_source_captures','market_source_captures','issuer_quality','annual_quality','policy','coverage_evidence','issuer_balance_record','balance_record']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function compactTaiwanPriceReference(reference,pool,bindings=Object.create(null)){
 if(reference===null)return null;
 const original=Object.hasOwn(reference,'reference_hash')?reference:{...reference,reference_hash:marketSnapshotHash(reference)};
 const visit=(value,security=reference.security_id)=>{
  if(Array.isArray(value))return value.map(v=>visit(v,security));if(!object(value))return value;
  security=value.security_id??security;
  if(Object.hasOwn(value,'$price_input_ref'))fail('RESERVED_FIELD');
  if(value.capture_id&&value.source_row_hash){const hash=marketSnapshotHash(value);
   if(!/^(TWSE|TPEX|EMERGING):\d{4,6}$/.test(security??'')||bindings[hash]&&bindings[hash]!==security)fail('SOURCE_IDENTITY');bindings[hash]=security;}
  return Object.fromEntries(Object.entries(value).map(([key,child])=>{
   const encoded=visit(child,security);if(keys.has(key)&&(object(encoded)||Array.isArray(encoded))){const hash=marketSnapshotHash(encoded);
    if(pool[hash]&&marketSnapshotHash(pool[hash])!==hash)fail('POOL_COLLISION');pool[hash]=encoded;return [key,{$price_input_ref:hash}];}
   return [key,encoded];
  }));
 };
 const encoded=visit(original);
 return {...encoded,input_encoding:'SHARED_PRICE_INPUTS_V1',encoded_hash:marketSnapshotHash(encoded)};
}
export function expandTaiwanPriceReference(reference,pool){
 if(reference===null)return null;
 const {input_encoding,encoded_hash,...encoded}=reference;
 if(input_encoding!=='SHARED_PRICE_INPUTS_V1'||encoded_hash!==marketSnapshotHash(encoded))fail('ENCODED_HASH');
 const stack=new Set(),cache=new Map();
 const visit=(value,depth=0)=>{
  if(depth>40)fail('DEPTH');if(Array.isArray(value))return value.map(v=>visit(v,depth+1));if(!object(value))return value;
  if(Object.hasOwn(value,'$price_input_ref')){const hash=value.$price_input_ref;
   if(Object.keys(value).length!==1||!/^[a-f0-9]{64}$/.test(hash)||!pool[hash]||marketSnapshotHash(pool[hash])!==hash||stack.has(hash))fail('POOL_BINDING');
   if(cache.has(hash))return cache.get(hash);stack.add(hash);const expanded=visit(pool[hash],depth+1);stack.delete(hash);cache.set(hash,expanded);return expanded;
  }
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v,depth+1)]));
 };
 const expanded=visit(encoded),{reference_hash,...body}=expanded;
 if(reference_hash!==marketSnapshotHash(body))fail('REFERENCE_HASH');return expanded;
}

/** Member summaries describe observed ranges / relative-price sensitivity.
 * They never turn into entry orders, intrinsic-value estimates or forecasts. */
export function taiwanResearchReferenceSummary({security_id,horizon,reference,input_pool_hash}){
 if(!reference)return null;const symbol=security_id.split(':')[1];
 const observed=horizon==='SHORT'&&reference.schema==='TAIWAN_OBSERVED_PRICE_RANGE_V1';
 if(!observed&&reference.state!=='CALCULATED_RESEARCH_ONLY')return null;
 const prices=observed?[reference.range[0],null,reference.range[1]]:reference.price_scenarios;
 const date=reference.quote_date??reference.through,price=reference.current_price;
 if(!/^\d{4}-\d\d-\d\d$/.test(date??'')||!Array.isArray(prices)||prices.length!==3
  ||![prices[0],prices[2],price].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||prices[0]>prices[2]
  ||prices[1]!==null&&!(prices[1]>=prices[0]&&prices[1]<=prices[2]))fail('SUMMARY_VALUES');
 return {schema:'DAILY_AI_MARKET_RESEARCH_REFERENCE_V1',status:'CALCULATED_RESEARCH_ONLY',symbol,horizon,
  method_id:observed?'OBSERVED_UNADJUSTED_20_SESSION_RANGE':reference.method,
  method_version:reference.method_version??(horizon==='SHORT'?'TAIWAN_OBSERVED_RANGE_V1':'TAIWAN_PEER_RERATING_V1'),
  quote_date:date,current_price:price,lower:prices[0],median:prices[1],upper:prices[2],peer_count:observed?null:reference.peer_count,
  reference_hash:reference.reference_hash,input_pool_hash,forecast:false,buy_ready:false,methodology_approved:false};
}
