import {createServer} from 'vite';
import {startAuthEnvironment,verifyAuthEnvironment} from './auth-environment.mjs';
const runtime=await startAuthEnvironment();
try{
 console.log(JSON.stringify(await verifyAuthEnvironment(runtime)));
 process.env.MA_ACADEMY_REAL_AUTH='LOCAL_ONLY';process.env.MA_ACADEMY_LOCAL_ANON=runtime.anon;
 const server=await createServer({configFile:new URL('../../tests/browser/academy-auth.vite.ts',import.meta.url).pathname});
 await server.listen();console.log('REAL_AUTH_PREVIEW=http://127.0.0.1:3219/academy');
 const stop=async()=>{await server.close();runtime.cleanup();process.exit(0);};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch(error){runtime.cleanup();throw error;}
