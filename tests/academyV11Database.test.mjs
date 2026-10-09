import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contentSql} from '../scripts/academy-v11/load-content.mjs';
import {syntheticLessons} from './fixtures/academy-v11-lessons.mjs';
const sql=readFileSync(new URL('../supabase/migrations/20261009053655_academy_member_learning_v11.sql',import.meta.url),'utf8');
test('academy candidate changes only additive academy objects',()=>{
 assert.equal((sql.match(/create table public\./g)||[]).length,3);
 assert.equal((sql.match(/force row level security/g)||[]).length,3);
 assert.doesNotMatch(sql,/alter table public\.(?!academy_)|create or replace|drop |truncate |update public\.(?!academy_progress_v11)/i);
 assert.match(sql,/public\.is_research_owner_v1\(\)/);
 assert.doesNotMatch(sql,/user_metadata|raw_user_meta_data|service_role_key/i);
});
test('progress is identity bound, server graded, row locked and explicit grants only',()=>{
 assert.match(sql,/for update;/);
 assert.match(sql,/p_choice_index=\(q->>'correctIndex'\)::integer/);
 assert.match(sql,/ACADEMY_QUIZ_INCOMPLETE/);
 assert.match(sql,/user_id=auth\.uid\(\)/);
 assert.match(sql,/from public,anon,authenticated,service_role/);
 assert.match(sql,/not coalesce\(u\.is_anonymous,false\)/);
 for(const def of sql.split('create function ').slice(1)) assert.match(def.split('$$;')[0],/set search_path=''/);
});
test('member content manifest contains no lesson bodies or PDF payloads',()=>{
 const m=JSON.parse(readFileSync(new URL('../docs/academy/v11/content-manifest.json',import.meta.url)));
 assert.equal(m.chapters.length,10);assert.equal(m.chapters.filter(c=>c.tier==='free').length,7);
 for(const c of m.chapters){assert.equal(c.content,undefined);assert.equal(c.answers,undefined);assert.match(c.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(m.pdf,undefined);assert.equal(m.rights,'ORIGINAL_MEMBER_EDUCATION');
});
test('CI content is explicitly synthetic and SQL-only loader has no network',()=>{
 const payload=contentSql(syntheticLessons);
 assert.ok(payload.startsWith('begin;'));assert.ok(payload.endsWith('commit;\n'));
 assert.match(payload,/SYNTHETIC/);
 const loader=readFileSync(new URL('../scripts/academy-v11/load-content.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(loader,/fetch\(|createClient\(|execFile|process\.env/);
 assert.match(loader,/UNREVIEWED_CONTENT/);assert.match(loader,/UNREVIEWED_PDF/);
});
