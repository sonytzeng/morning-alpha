#!/usr/bin/env node
// Test transport only. Execute the unchanged historical SQL in a network-none
// PostgreSQL container with a pinned clock, never on the host/Production server.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const container=process.env.MA_TEST_DOCKER_CONTAINER||'';
assert.match(container,/^ma-news-clock-(?:ci|local)-[a-z0-9-]+$/);
assert.equal(execFileSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container],{encoding:'utf8'}).trim(),'none');
const args=process.argv.slice(2);let input;
for(let i=0;i<args.length;i++){
 if(args[i]==='-h')assert.equal(args[++i],'127.0.0.1');
 else if(args[i]==='-p'){assert.match(args[i+1],/^\d+$/);args[++i]='5432';}
 else if(args[i]==='-d')assert.match(args[++i],/^(?:postgres|ma_(?:txf_session_parity|tw_cash_phase|premarket_parity)_test\d+)$/);
 else if(args[i]==='-f'){
  const path=resolve(args[++i]),local=relative(root,path);
  assert.match(local,/^(?:tests\/fixtures|supabase\/migrations)\/[^/]+\.sql$/);
  input=readFileSync(path);args[i]='-';
 }
}
const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres',...args],{
 input,encoding:'utf8',timeout:30_000,maxBuffer:8*1024*1024,
});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
if(result.error)throw result.error;
process.exit(result.status??1);
