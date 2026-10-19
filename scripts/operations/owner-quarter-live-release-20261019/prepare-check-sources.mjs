import process from 'node:process';
import console from 'node:console';
// Fixed ignored build trees for offline actual-entrypoint compile verification.
import assert from 'node:assert/strict';
import {lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleRelease,readReleaseCatalog,VARIANTS} from './materialize.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
assert.equal(process.argv.length,2,'QUARTER_CHECK_NO_ARGUMENTS');
function directory(path){
 const parts=path.split('/');let current=root;
 for(const part of parts){current=resolve(current,part);try{const s=lstatSync(current);assert(s.isDirectory()&&!s.isSymbolicLink(),'QUARTER_CHECK_DIRECTORY');}
  catch(error){if(error.code!=='ENOENT')throw error;mkdirSync(current,{mode:0o700});}}
}
const results=[],catalog=readReleaseCatalog();
for(const variant of VARIANTS){
 const {payload,sha256}=assembleRelease(variant),base='build/owner-quarter-live-typecheck/'+variant;
 for(const file of payload.files){const relative=base+'/'+file.name;directory(relative.slice(0,relative.lastIndexOf('/')));writeFileSync(resolve(root,relative),file.content,{flag:'wx',mode:0o600});}
 // This map is only for the offline compiler. The Function has no import map,
 // and no runtime module imports either of these two bare declaration ports.
 const imports=Object.fromEntries(Object.entries(catalog.type_compile_ports).map(([name,path])=>[name,'./'+path]));
 for(const [source,target]of Object.entries(catalog.type_compile_aliases)){if(payload.files.some(f=>f.name===target))imports['./'+source]='./'+target;}
 for(const native of catalog.type_native_ports)imports[native.slice(5)]=native;
 // Deno treats a bare triple-slash path as an import-map specifier. Keep the
 // official declaration bytes and map only its exact, already sealed local
 // target within the declaring directory; no fallback or remote resolution.
 const names=new Set(payload.files.map(file=>file.name)),scopes={};
 let referencePaths=0;
 for(const file of payload.files.filter(file=>/\.d\.(?:ts|mts|cts)$/.test(file.name))){
  for(const match of file.content.matchAll(/^\/\/\/\s*<reference\s+path=["']([^"']+)["']/gm)){
   const specifier=match[1];
   if(specifier.startsWith('.'))continue;
   assert(!specifier.includes(':')&&!specifier.startsWith('/'),'QUARTER_TYPE_REFERENCE_LOCAL');
   const target=posix.normalize(posix.join(posix.dirname(file.name),specifier));
   assert(names.has(target),'QUARTER_TYPE_REFERENCE_MISSING:'+target);
   const scope='./'+posix.dirname(file.name)+'/',value='./'+target;
   scopes[scope]??={};
   assert(!Object.hasOwn(scopes[scope],specifier)||scopes[scope][specifier]===value,'QUARTER_TYPE_REFERENCE_CONFLICT');
   scopes[scope][specifier]=value;referencePaths++;
  }
 }
 assert.equal(referencePaths,80,'QUARTER_FIXED_OFFICIAL_REFERENCE_PATHS');
 const config={nodeModulesDir:'none',imports,scopes,compilerOptions:{types:['./'+catalog.type_compile_ports.node]}};
 writeFileSync(resolve(root,base,'deno.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 results.push({variant,source_files:payload.files.length,payload_sha256:sha256,compiler_only_reference_paths:referencePaths,entrypoint:base+'/'+payload.entrypoint_path});
}
console.info(JSON.stringify({status:'ACTUAL_SOURCE_TREES_PREPARED_NOT_COMPILED_OR_DEPLOYED',network_requests:0,results}));
