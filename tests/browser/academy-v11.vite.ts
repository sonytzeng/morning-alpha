import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3218';
const ids:Record<string,string>={free:'00000000-0000-4000-8000-000000000001',premium:'00000000-0000-4000-8000-000000000002',owner:'00000000-0000-4000-8000-000000000003',other:'00000000-0000-4000-8000-000000000004'};
const sessions=new Map<string,string>();
export default defineConfig(({command})=>{
 const db=process.env.MA_ACADEMY_BROWSER_DB||'';
 if(command!=='serve'||process.env.MA_ACADEMY_PREVIEW!=='ISOLATED_DATABASE'||!/^ma_academy_v11_\d+$/.test(db))throw Error('ISOLATED_ONLY');
 const sql=(s:string)=>execFileSync('psql',['-X','-q','-h','/private/tmp','-p','55439','-U','academy_test','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',maxBuffer:8e6,stdio:['pipe','pipe','pipe']}).trim();
 const q=(v:unknown)=>v===null?'null':typeof v==='number'?String(v):typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 return {root,envDir:false,envPrefix:'ACADEMY_UNUSED_',publicDir:false,cacheDir:'/private/tmp/ma-academy-v11-vite-cache',
 define:{__ACADEMY_LOCAL_ISOLATED__:'false'},
 plugins:[react(),{name:'isolated-academy-database',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.headers.host!=='127.0.0.1:3218'||(req.headers.origin&&req.headers.origin!==origin)){res.statusCode=403;res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const path=req.url?.split('?')[0];
  if(path==='/academy'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await server.transformIndexHtml('/academy',readFileSync(resolve(root,'tests/browser/academy-v11.html'),'utf8')));return;}
  if(!path?.startsWith('/__academy_test_'))return next();
  res.setHeader('Content-Type','application/json');
  const sid=req.headers.cookie?.match(/(?:^|; )academy_test=([a-f0-9-]+)/)?.[1]||'';
  const role=sessions.get(sid),uid=role?ids[role]:null;
  try{
   if(path==='/__academy_test_identity'&&req.method==='GET'){res.end(JSON.stringify({id:uid||null}));return;}
   if(req.method!=='POST'||req.headers.origin!==origin)throw Error('TEST_REQUEST_DENIED');
   let raw='';for await(const chunk of req){raw+=String(chunk);if(raw.length>8000)throw Error('TEST_BODY_LIMIT');}
   const body=JSON.parse(raw);
   if(path==='/__academy_test_session'){
    sessions.delete(sid);const id=randomUUID();if(ids[body.role])sessions.set(id,body.role);
    res.setHeader('Set-Cookie',`academy_test=${id}; HttpOnly; SameSite=Strict; Path=/`);res.end('{}');return;
   }
   if(path!=='/__academy_test_rpc')throw Error('TEST_REQUEST_DENIED');
   const p=body.params||{},params:Record<string,unknown[]>={get_academy_catalog_v11:[],get_academy_lesson_v11:[p.p_chapter_id],get_academy_pdf_v11:[p.p_edition],record_academy_progress_v11:[p.p_chapter_id,p.p_question_id??null,p.p_choice_index??null,p.p_position??0,p.p_complete??false]};
   if(!Object.hasOwn(params,body.name))throw Error('TEST_RPC_DENIED');
   const result=sql(`begin;set local role ${uid?'authenticated':'anon'};set local request.jwt.claim.sub=${q(uid||'')};select public.${body.name}(${params[body.name].map(q).join(',')});commit;`);
   res.end(JSON.stringify({data:JSON.parse(result),error:null}));
  }catch{res.end(JSON.stringify({data:null,error:{code:'42501',message:'ISOLATED_ACCESS_DENIED'}}));}
 });}}],
 resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(root,'tests/browser/academy-v11.mock.ts')},{find:'@',replacement:resolve(root,'src')}]},
 server:{host:'127.0.0.1',port:3218,strictPort:true,cors:false,fs:{strict:true,allow:[root],deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']}},
 };
});
