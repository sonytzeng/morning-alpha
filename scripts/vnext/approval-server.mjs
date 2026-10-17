/** Unmounted loopback candidate. Auth truth comes only from existing Supabase RPC.
 * Private append-only journal demonstrates admission; not a Production DB writer. */
import {openSync,writeSync,fsyncSync,closeSync,readFileSync,existsSync,mkdirSync,lstatSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {inspectPublication,appendOwnerDecision,verifyJournal,verifyAdmission} from '../../src/features/vnext/publicationAdmission.ts';
import {readOwnerResearch} from './owner-research-server.mjs';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';

export function createApprovalService({review,admission,registry,directory,requester=fetch,clock=()=>new Date().toISOString()}){
 const dir=resolve(directory);
 if(!dir.startsWith('/private/tmp/ma-vnext-approval-')&&!dir.startsWith('/tmp/ma-vnext-approval-'))throw Error('ISOLATED_JOURNAL_ONLY');
 mkdirSync(dir,{recursive:true,mode:0o700});if(!lstatSync(dir).isDirectory()||lstatSync(dir).isSymbolicLink()||(lstatSync(dir).mode&0o077))throw Error('JOURNAL_PERMISSIONS');
 const file=resolve(dir,'decisions.jsonl');let queue=Promise.resolve();
 const read=()=>{if(!existsSync(file))return [];const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('JOURNAL_PERMISSIONS');return readFileSync(file,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s));};
 const write=event=>{const fd=openSync(file,'ax',0o600);try{writeSync(fd,JSON.stringify(event)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};
 // One server process owns a journal; O_NOFOLLOW prevents symlink redirection.
 const append=event=>{if(!existsSync(file)){write(event);return;}read();const fd=openSync(file,constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{writeSync(fd,JSON.stringify(event)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};
 async function decision(request){
  if(request.method!=='POST')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
  const auth=await readOwnerResearch({method:'GET',authorization:request.authorization},[],requester);
  if(auth.status!==200)return auth;
  const body=request.body;
  if(!body||Object.keys(body).sort().join(',')!=='action,idempotency_key,reason,review_hash'||typeof body.reason!=='string'||typeof body.idempotency_key!=='string')return {status:400,body:{error:'DECISION_REQUEST_INVALID'}};
  const card=review.cards.find(c=>c.review_hash===body.review_hash),stored=admission.cards.find(c=>c.review_hash===body.review_hash);
  if(!card||!stored)return {status:404,body:{error:'REVIEW_NOT_FOUND'}};
  try{
   if(!await verifyAdmission(admission,review))throw Error('ADMISSION_LOCK_INVALID');
   const userResponse=await requester('http://127.0.0.1:55632/user',{headers:{Authorization:request.authorization},signal:AbortSignal.timeout(5000)});
   if(!userResponse.ok)throw Error('OWNER_REQUIRED');
   const {id}=await userResponse.json();if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('OWNER_REQUIRED');
   const ownerRef='OWNER:'+await snapshotHash({id});
   const now=clock(),fresh=await inspectPublication(card,registry,now),journal=read();
   if(!await verifyJournal(journal))throw Error('AUDIT_CHAIN_INVALID');
   if(body.action==='APPROVE'&&!fresh.owner_approval_ready)return {status:409,body:{error:'PREREQUISITES_NOT_PASSED',blocking:fresh.matrix.filter(x=>x.state!=='PASS'&&x.key!=='RAW_REDISTRIBUTION').map(x=>x.key)}};
   const event=await appendOwnerDecision(card,stored,journal,{action:body.action,reason:body.reason,key:body.idempotency_key},{verified:true,ref:ownerRef},now);
   const duplicate=journal.some(e=>e.event_hash===event.event_hash);if(!duplicate)append(event);
   return {status:200,body:{scope:'ISOLATED_APPROVAL_CANDIDATE_NOT_PUBLISHED',duplicate,event}};
  }catch(e){return {status:409,body:{error:['IDEMPOTENCY_CONFLICT','STALE_REVIEW','DECISION_INVALID','AUDIT_TIME_REGRESSION'].includes(e.message)?e.message:'APPROVAL_REJECTED'}};}
 }
 return {handle(request){const next=queue.then(()=>decision(request));queue=next.then(()=>undefined,()=>undefined);return next;},read};
}
