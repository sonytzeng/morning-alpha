// Build the unmounted member candidate separately from the unchanged live app.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
const root=new URL('../../',import.meta.url).pathname;
await build({configFile:false,root,envDir:false,envPrefix:'VNEXT_UNUSED_',publicDir:false,
 plugins:[react()],css:{postcss:{plugins:[]}},resolve:{alias:[
  {find:'@/lib/supabase',replacement:resolve(root,'tests/browser/vnext.client.ts')},
  {find:'@',replacement:resolve(root,'src')}]},
 build:{outDir:process.env.MA_VNEXT_BUILD_DIR||'/private/tmp/ma-vnext-member-build',emptyOutDir:false,
  rollupOptions:{input:resolve(root,'tests/browser/vnext.harness.tsx')},target:'es2022'}});
