import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {readPrivate,sha,privateDirectory} from './foundation-history.mjs';
import {traceIssues} from '../../src/features/vnext/researchFunnel.ts';
export function readStockSnapshot(directory,prefix,schema,historyHash){
 const dir=privateDirectory(directory),files=readdirSync(dir).filter(n=>new RegExp('^'+prefix+'-[a-f0-9]{64}\\.json$').test(n)),all=files.map(n=>{const r=readPrivate(resolve(dir,n));if(r.schema!==schema||r.history_hash!==historyHash||n!==prefix+'-'+sha(r)+'.json')throw Error('STOCK_SNAPSHOT_INVALID');return r;});
 const r=all.sort((a,b)=>a.collected_at.localeCompare(b.collected_at)).at(-1);if(!r)throw Error('STOCK_ACQUISITION_INCOMPLETE');
 const rows=r.rows??r.events,keys=new Set();for(const f of rows){if(traceIssues(f,r.collected_at).length)throw Error('STOCK_POINT_IN_TIME_INVALID');const key=f.symbol+':'+f.kind+':'+(f.kind==='EVENT'?f.id:f.period);if(keys.has(key))throw Error('STOCK_DUPLICATE_PERIOD');keys.add(key);}
 if(r.rows&&(r.production_operations!==0||r.forward_sample!==0||r.outcome_sample!==0||r.universe.length!==72))throw Error('STOCK_SCOPE_INVALID');return r;
}
