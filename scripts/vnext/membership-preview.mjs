// No Production connectivity: all Auth/SQL below is a fresh disposable runtime.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {startAuthEnvironment,localAuthBase,localRestBase} from '../academy-v11/auth-environment.mjs';
import {installMembershipCandidate,verifyMembershipPolicy} from '../../tests/membershipPolicy.integration.mjs';
import {resolveEffectiveMemberAccess} from '../../supabase/functions/_shared/member-entitlement.ts';
const port=Number(process.env.MA_MEMBERSHIP_PREVIEW_PORT||3225);
if(![3225,3226].includes(port))throw Error('ISOLATED_MEMBERSHIP_PREVIEW_PORT_DENIED');
const runtime=await startAuthEnvironment(),root=new URL('../../',import.meta.url).pathname,origin='http://127.0.0.1:'+port;
try{
 await installMembershipCandidate(runtime);const results=await verifyMembershipPolicy(runtime);delete results.accounts;console.log(JSON.stringify(results));
 const server=await createServer({configFile:false,root,envDir:false,envPrefix:'LOCAL_UNUSED_',publicDir:false,cacheDir:'/private/tmp/ma-membership-vite',
  plugins:[react(),{name:'isolated-membership',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
   if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==origin){res.statusCode=403;res.end();return;}
   res.setHeader('Cache-Control','no-store');const path=req.url?.split('?')[0];
   const json=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
   if(path==='/__vnext_public_config'){json(200,{anon:runtime.anon});return;}
   if(path==='/__membership_access'){
    if(req.method!=='POST'){json(405,{});return;}
    try{
     const response=await fetch(localAuthBase+'/user',{headers:{Authorization:req.headers.authorization||''},signal:AbortSignal.timeout(3000)});
     if(!response.ok){json(401,{});return;}const user=await response.json();
     if(!/^[a-f0-9-]{36}$/.test(user.id)){json(401,{});return;}
     const row=JSON.parse(runtime.sql(`select to_jsonb(public.ensure_member_entitlement_v2('${user.id}'))::text`)||'null');
     const profile=JSON.parse(runtime.sql(`select to_jsonb(p)::text from public.profiles p where id='${user.id}'`));
     const offer=JSON.parse(runtime.sql('select to_jsonb(c)::text from public.membership_access_config c'));
     const receipt=JSON.parse(runtime.sql(`select public.get_member_policy_receipt_v1('${user.id}')`));
     json(200,{success:true,authenticated:true,user:{id:user.id,email:user.email},membership:{...resolveEffectiveMemberAccess(profile,row),legacyReviewRequired:receipt.legacy_review_required},offer,server_time:new Date().toISOString()});return;
    }catch{json(503,{error:'LOCAL_POLICY_UNAVAILABLE'});return;}
   }
   if(path==='/functions/v1/get-report-payload'){json(200,{payload:null,report_date:null});return;}
   if(['/membership','/pricing','/stocks','/schedule-review'].includes(path)){
    res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await vite.transformIndexHtml('/membership','<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Morning Alpha 會員政策候選</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/tests/browser/membership.harness.tsx"></script></body></html>'));return;
   }next();
  });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(root,'tests/browser/vnext.client.ts')},{find:'@/services/membershipService',replacement:resolve(root,'tests/browser/membership.client.ts')},{find:'@/components/base/MarketStatusLight',replacement:resolve(root,'tests/browser/membership.market.tsx')},{find:'@',replacement:resolve(root,'src')}]},
  server:{host:'127.0.0.1',port,strictPort:true,cors:false,fs:{strict:true,allow:[root],deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']},proxy:{'/auth/v1':{target:localAuthBase,rewrite:p=>p.replace(/^\/auth\/v1/,'')},'/rest/v1':{target:localRestBase,rewrite:p=>p.replace(/^\/rest\/v1/,'')}}}});
 await server.listen();console.log('MEMBERSHIP_PREVIEW='+origin+'/membership');
 await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});await server.close();
}finally{runtime.cleanup();}
