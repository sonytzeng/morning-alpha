/** Read-only presentation of server-owned admission. Never grants publication. */
import type {Admission,AdmissionBundle} from './publicationAdmission';
export type BlockerCategory='READY'|'DATA_PENDING'|'LICENSING_PENDING'|'QUALITY_FAIL';
export const BLOCKER_LABELS:Record<BlockerCategory,string>={READY:'可以核准',DATA_PENDING:'尚待補資料',LICENSING_PENDING:'使用權待確認',QUALITY_FAIL:'品質未通過'};
export function blockerCategories(a:Admission):BlockerCategory[]{
 const c:BlockerCategory[]=[];
 if(a.owner_approval_ready)c.push('READY');
 if(a.quality==='FAIL')c.push('QUALITY_FAIL');
 if(a.quality==='INCOMPLETE'||!a.time_valid)c.push('DATA_PENDING');
 if(!a.license_valid)c.push('LICENSING_PENDING');
 return c;
}
export function publicationMatrix(a:Admission){
 return {symbol:a.symbol,review_hash:a.review_hash,
  quality_status:a.quality==='PASS'?'QUALITY_PASS':a.quality==='FAIL'?'QUALITY_FAIL':'QUALITY_PENDING',
  time_status:a.time_valid?'TIME_PASS':a.matrix.find(m=>m.key==='TIME_METADATA')?.state==='FAIL'?'TIME_FAIL':'TIME_PENDING',
  licensing_status:a.license_valid?'LICENSING_APPROVED':'LICENSING_PENDING',
  owner_approval_readiness:a.owner_approval_ready?'READY':'NOT_READY',
  publication_eligibility:a.owner_approval_ready?'ELIGIBLE_FOR_OWNER_REVIEW':'NOT_ELIGIBLE',
  // Eligibility is NOT an Owner decision or a published member projection.
  categories:blockerCategories(a),evidence:a.matrix};
}
export function blockerCounts(bundle:AdmissionBundle){
 return Object.fromEntries((Object.keys(BLOCKER_LABELS) as BlockerCategory[]).map(key=>[key,bundle.cards.filter(a=>blockerCategories(a).includes(key)).length])) as Record<BlockerCategory,number>;
}
