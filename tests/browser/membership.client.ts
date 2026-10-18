// Local UI transport only. User identity is verified by real isolated GoTrue.
import {supabase} from './vnext.client';
import type {MemberAccessResponse} from '../../src/types/membership';
export async function fetchMemberAccess(action:'activate'|'status'='status'):Promise<MemberAccessResponse>{
 const {data}=await supabase.auth.getSession();
 const r=await fetch('/__membership_access',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(data.session?.access_token||'')},body:JSON.stringify({action})});
 if(!r.ok)throw Error('LOCAL_MEMBER_ACCESS_FAILED');return r.json();
}
export async function signOutMembership(){const {error}=await supabase.auth.signOut();if(error)throw error;}
