import {createServer} from 'vite';
import {environment,installCandidate,verifyCandidate,verifyInstalledCandidate} from './isolation.mjs';
const runtime=await environment();
try{
 if(process.env.MA_VNEXT_REUSE_LOCAL_DB&&runtime.sql("select count(*) from pg_namespace where nspname='vnext_private'")==='1')verifyInstalledCandidate(runtime);
 else installCandidate(runtime);
 console.log(JSON.stringify(await verifyCandidate(runtime)));
 process.env.MA_VNEXT_LOCAL='ISOLATED_ONLY';process.env.MA_VNEXT_ANON=runtime.anon;
 const server=await createServer({configFile:new URL('../../tests/browser/vnext.vite.ts',import.meta.url).pathname});
 await server.listen();console.log('VNEXT_PREVIEW=http://127.0.0.1:3220/vnext');
 const stop=async()=>{await server.close();runtime.cleanup();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch(error){runtime.cleanup();throw error;}
