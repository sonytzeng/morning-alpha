// Read-only generator. Outputs a proposed candidate manifest for review;
// tests never regenerate or automatically accept changed hashes.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,normalize} from 'node:path';
const names=['fetch-market-data-v10','market-readiness-preflight','generate-daily-report-v7','daily-delivery-orchestrator',
 'line-daily-push','closing-verification-engine','close-market-review','continuous-learning-engine','opening-market-radar','ma-ops-health-check','fetch-global-market-news'];
const read=path=>readFileSync(new URL('../../'+path,import.meta.url));
const files={},functions={};
function walk(path,seen){if(seen.has(path))return;seen.add(path);const bytes=read(path);
 files[path]=createHash('sha256').update(bytes).digest('hex');
 for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))walk(normalize(dirname(path)+'/'+match[1]),seen);
}
for(const name of names){const seen=new Set();walk('supabase/functions/'+name+'/index.ts',seen);functions[name]=[...seen].sort();}
console.log(JSON.stringify({schema_version:'REVIEWED_FUNCTION_DEPENDENCY_CLOSURE_V1',base_sha:'2e530bc0db49bf76d6188642b79e112b339872aa',
 production_change_authorized:false,cron_change:false,production_config_drift:'PENDING_SEPARATE_DEPLOYMENT_APPROVAL',
 news_preservation:'Existing deployed v56 bounded 429 cooldown retained verbatim; no news strategy change.',functions,files:Object.fromEntries(Object.entries(files).sort())}));
