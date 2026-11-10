/** Private future ACTION evidence only. No source request or approval port. */
import {hashValid,snapshotHash} from './contracts.ts';

export const ACTION_RESPONSE_MAX_BYTES=8_000_000;
export const ACTION_RECEIPT_MAX_BYTES=12_000_000;
export type ActionResponseCapture={
 schema:'VNEXT_ACTION_RESPONSE_TEXT_V1';encoding:'UTF-8';
 hash_scheme:'SNAPSHOT_HASH_CANONICAL_JSON_STRING_SHA256';
 response_bytes:number;text_utf8_bytes:number;utf8_bom_removed:boolean;text:string;
};
const encoder=new TextEncoder();

/** Match the existing decoded-text raw_hash preimage. A leading UTF-8 BOM is
 * recorded separately because the existing TextDecoder removes it. Invalid
 * UTF-8 is rejected, never silently replaced and presented as original text. */
export function captureActionResponse(bytes:Uint8Array):ActionResponseCapture{
 if(bytes.byteLength>ACTION_RESPONSE_MAX_BYTES)throw Error('SOURCE_SIZE_LIMIT');
 const bom=bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf;
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('ACTION_RESPONSE_ENCODING');}
 const encoded=encoder.encode(text),offset=bom?3:0;
 if(encoded.length+offset!==bytes.length||encoded.some((value,index)=>value!==bytes[index+offset]))throw Error('ACTION_RESPONSE_ENCODING');
 return {schema:'VNEXT_ACTION_RESPONSE_TEXT_V1',encoding:'UTF-8',
  hash_scheme:'SNAPSHOT_HASH_CANONICAL_JSON_STRING_SHA256',response_bytes:bytes.length,
  text_utf8_bytes:encoded.length,utf8_bom_removed:bom,text};
}

/** Absence remains a legacy receipt. Presence must bind the complete retained
 * text to the unchanged SourceReceipt.raw_hash scheme, not an HTTP byte hash. */
export async function validateActionResponseCapture(value:unknown,rawHash:string):Promise<'LEGACY_CAPTURE_ABSENT'|'RETAINED_TEXT_VALID'>{
 if(value===undefined)return 'LEGACY_CAPTURE_ABSENT';
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('ACTION_RESPONSE_CAPTURE_INVALID');
 const capture=value as Record<string,unknown>;
 const keys=['schema','encoding','hash_scheme','response_bytes','text_utf8_bytes','utf8_bom_removed','text'];
 if(Object.keys(capture).length!==keys.length||keys.some(key=>!Object.hasOwn(capture,key))
  ||capture.schema!=='VNEXT_ACTION_RESPONSE_TEXT_V1'||capture.encoding!=='UTF-8'
  ||capture.hash_scheme!=='SNAPSHOT_HASH_CANONICAL_JSON_STRING_SHA256'
  ||typeof capture.text!=='string'||typeof capture.utf8_bom_removed!=='boolean'
  ||!Number.isSafeInteger(capture.response_bytes)||!Number.isSafeInteger(capture.text_utf8_bytes)
  ||Number(capture.response_bytes)<0||Number(capture.response_bytes)>ACTION_RESPONSE_MAX_BYTES
  ||Number(capture.text_utf8_bytes)<0||Number(capture.text_utf8_bytes)>ACTION_RESPONSE_MAX_BYTES
  ||capture.response_bytes!==Number(capture.text_utf8_bytes)+(capture.utf8_bom_removed?3:0)
  ||encoder.encode(capture.text).length!==capture.text_utf8_bytes||!hashValid(rawHash))throw Error('ACTION_RESPONSE_CAPTURE_INVALID');
 if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(encoder.encode(capture.text))!==capture.text)throw Error('ACTION_RESPONSE_ENCODING');
 if(await snapshotHash(capture.text)!==rawHash)throw Error('ACTION_RESPONSE_HASH_MISMATCH');
 return 'RETAINED_TEXT_VALID';
}

/** JSON key sorting changes no bytes in the serialized length. This checks
 * the entire canonical receipt, including escaping, before SOURCE_SAVE. */
export function assertActionReceiptSize(receipt:unknown):void{
 if(encoder.encode(JSON.stringify(receipt)).length>ACTION_RECEIPT_MAX_BYTES)throw Error('ACTION_RECEIPT_SIZE_LIMIT');
}
