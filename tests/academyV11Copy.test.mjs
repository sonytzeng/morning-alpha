import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('member copy uses Traditional Chinese guidance, without developer instructions',()=>{
 const source=read('src/pages/academy/MemberAcademy.tsx');
 for(const label of ['YOUR LEARNING PATH','PUT IT IN CONTEXT','PAUSE & CHECK','MAKE IT YOURS','LEARN AT YOUR OWN PACE','CHECK YOUR UNDERSTANDING','FREE / FOUNDATIONS','PREMIUM / ADVANCED','私人章節'])assert.ok(!source.includes(label),label);
 for(const label of ['免費 · 基礎','學習目錄','Premium 進階課程','繼續上次第','標記本章完成'])assert.ok(source.includes(label),label);
 assert.equal((source.match(/<Diagram\b/g)||[]).length,(source.match(/<Diagram member\b/g)||[]).length,'all member diagrams use member copy');
 assert.match(read('src/pages/academy/Diagram.tsx'),/member = false/,'private V1 default unchanged');
});
test('real Auth acceptance harness cannot be a production identity provider',()=>{
 const client=read('tests/browser/academy-auth.client.ts'),config=read('tests/browser/academy-auth.vite.ts'),harness=read('tests/browser/academy-auth.harness.tsx');
 assert.match(client,/createClient/);assert.doesNotMatch(client,/mock|switchTestIdentity/);
 assert.match(harness,/auth.signInWithPassword/);assert.match(harness,/auth.signOut/);assert.doesNotMatch(harness,/[?&]role=|switchTestIdentity/);
 assert.match(config,/command!=='serve'/);assert.match(config,/LOCAL_ONLY/);assert.match(config,/host:'127.0.0.1'/);assert.match(config,/publicDir:false/);
 assert.doesNotMatch(read('src/lib/supabase.ts'),/academy-auth/);
});
