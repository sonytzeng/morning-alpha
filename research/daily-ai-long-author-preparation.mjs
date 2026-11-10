/** Candidate wrapper around the unchanged daily author. Rebuild the review
 * material from each exact daily packet and calculation. An expired sealed
 * qualitative review is never required to create new review material. */
import {authorDailyResearch} from './daily-ai-zero-paid-author.mjs';
import {prepareDailyAiLongRationale} from './daily-ai-long-rationale.ts';
import {snapshotHash,validObservationTime,compareTime} from '../src/features/vnext/contracts.ts';

export async function authorDailyResearchWithLongPreparation(args,deps,options){
 if(!options||typeof options!=='object'||Array.isArray(options)
  ||Object.keys(options).some(k=>!['as_of','calculation_inputs','source_supplements','symbols'].includes(k))
  ||!validObservationTime(options.as_of))throw Error('LONG_AUTHOR_OPTIONS');
 const inputs=structuredClone(options.calculation_inputs??{}),supplements=structuredClone(options.source_supplements??{});
 if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||!supplements||typeof supplements!=='object'||Array.isArray(supplements))throw Error('LONG_AUTHOR_INPUTS');
 // Existing validation, 72-stock identity, numeric assertions and immutable
 // snapshot preparation run first. This wrapper never edits their result.
 const draft=await authorDailyResearch(args,deps),batch=JSON.parse(args.batchText),now=args.now??Date.now();
 if(compareTime(args.prepared_at,options.as_of)>0||compareTime(options.as_of,new Date(now).toISOString())>0)throw Error('LONG_AUTHOR_TIME');
 const known=Object.keys(batch.packet_texts),symbols=options.symbols??known;
 if(!Array.isArray(symbols)||symbols.length>72||new Set(symbols).size!==symbols.length
  ||symbols.some(symbol=>!known.includes(symbol))||[...Object.keys(inputs),...Object.keys(supplements)].some(symbol=>!symbols.includes(symbol)))throw Error('LONG_AUTHOR_UNIVERSE');
 const items=[];
 for(const symbol of symbols.slice().sort()){
  let expiry=args.expires_at;
  if(inputs[symbol]){if(!validObservationTime(inputs[symbol].expires_at))throw Error('LONG_AUTHOR_INPUT_EXPIRY');
   if(compareTime(inputs[symbol].expires_at,expiry)<0)expiry=inputs[symbol].expires_at;}
  items.push(await prepareDailyAiLongRationale({packet:JSON.parse(batch.packet_texts[symbol]),
   calculation_input:inputs[symbol]??null,source_supplement:supplements[symbol]??null,as_of:options.as_of,expires_at:expiry,now}));
 }
 const expiry=[args.expires_at,...items.map(i=>i.expires_at)].sort(compareTime)[0];
 const body={schema:'DAILY_AI_LONG_AUTHOR_PREPARATION_V1',batch_id:draft.body.batch_id,source_snapshot_hash:draft.validation.snapshot_hash,
  as_of:options.as_of,expires_at:expiry,items,
  counts:{ready_for_review:items.filter(i=>i.status==='READY_FOR_REVIEW').length,data_required:items.filter(i=>i.status==='DATA_REQUIRED_REVIEW_PREPARATION').length},
  review:null,selection_qualified:false,member_published:false,source_batch_unchanged:true};
 return {...draft,long_review_preparation:{...body,preparation_hash:await snapshotHash(body)}};
}
