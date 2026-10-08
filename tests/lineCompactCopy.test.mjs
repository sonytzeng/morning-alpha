import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {composeDecisionCard,decisionCardFlex,linePlainText} from '../src/features/line/decisionCard.ts';
import {lineDecisionFixture} from './helpers/lineDecisionFixture.mjs';
import {LINE_COMPACT_PATHS,LINE_COMPACT_MANIFEST,lineCompactTransition,lineCompactPrior,lineCompactChangedPaths} from './helpers/lineCompactIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const all=c=>c.sections.flatMap(s=>s.lines.map(l=>l.text)).join('\n');
function fixture(){const r=lineDecisionFixture(),s=r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections;
 s.executive_summary={text:'TSM ADR -0.72% 對電子權值形成壓力；09:30 先看2330 是否相對加權指數抗跌且電子成交量同步，未確認前不追價。',evidence_refs:['MD001']};return r;}
test('single action, three concrete observations, concise all-conditions reference and exact numerical cancellation',()=>{
 const r=fixture(),before=structuredClone(r),c=composeDecisionCard(r),s=all(c);
 assert.deepEqual(c.sections[0].lines.map(l=>l.text),['先等，不追價。']);
 const observations=c.sections.find(s=>s.title==='開盤後只看 3 件事').lines;
 assert.equal(observations.length,3);assert(observations[0].text.includes('多數是否站上平盤，且成交量明顯增加'));
 assert(observations[2].text.includes('跌得比大盤少，且電子成交量同步'));
 const entry=c.sections.find(s=>s.title==='什麼時候可以開始找機會？').lines[0].text;
 assert.equal(entry,'09:30 確認以上三項都成立，才開始找機會；未齊就等。');assert(!/台積電|平盤|成交量/.test(entry));
 assert(s.includes('開盤突然朝預期相反方向變動超過 1%，或台積電與台指期一起轉弱'));
 assert(!/候選族群|放量|反向跳空|相對抗跌|比大盤抗跌/.test(s));
 assert.deepEqual(r,before);assert.equal(c.deliveryEnabled,false);assert.equal(c.recommendationSource,'PRODUCTION_V1');
});
test('strong label requires explicit, verified sector strength; observation or mixed/unknown is not strength',()=>{
 for(const [statement,refs,expected] of [['半導體：觀察',['MD001'],false],['半導體：轉弱',['MD001'],false],['半導體：轉強',['UNKNOWN'],false],['半導體：轉強',['MD001'],true]]){
  const r=fixture(),s=r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections;
  s.supporting_evidence.push({statement,evidence_refs:refs});const c=composeDecisionCard(r);
  assert.equal(all(c).includes('今天觀察的強勢族群'),expected);
  if(expected)assert(c.sections.find(s=>s.title==='開盤後只看 3 件事').lines[0].evidence.includes('MD001'));
 }
});
test('plain wording retains threshold, OR and sign; compact layout retains font sizes, colors and one CTA',()=>{
 assert.equal(linePlainText('開盤反向跳空超過 1.25% 或 TXF -0.72%，候選族群未放量。'),'開盤突然朝預期相反方向大幅變動超過 1.25% 或 台指期 -0.72%，今天觀察的族群成交量未明顯增加。');
 const c=composeDecisionCard(fixture()),f=decisionCardFlex(c);assert.equal(f.contents.body.paddingAll,'16px');
 assert.equal(f.contents.header.backgroundColor,'#071D33');assert.equal(f.contents.footer.contents.length,1);
 const ui=read('src/pages/admin/analysis/LineDecisionPreview.tsx').toString();assert(ui.includes('xs: 12, sm: 14, lg: 20'));assert(ui.includes("? 12 : 6"));
 assert(!/\.insert\(|\.update\(|api\.line\.me/.test(ui));
});
test('compact exact file set, hashes, predecessor lineage and protected business sources',()=>{
 const t=lineCompactTransition();assert.deepEqual(lineCompactChangedPaths(),[...LINE_COMPACT_PATHS,LINE_COMPACT_MANIFEST].sort());
 for(const r of t.manifest.files){if(r.operation==='ADD')assert.throws(()=>t.predecessorRead(r.path),{code:'ENOENT'});else assert.deepEqual(t.predecessorRead(r.path),lineCompactPrior(r.path));}
 for(const p of ['supabase/functions/line-daily-push/index.ts','supabase/functions/_shared/line-daily-flex-message.mjs','supabase/functions/_shared/market-publication-contract.ts','supabase/functions/_shared/recommendation-shadow-v2-engine.ts','supabase/config.toml','src/pages/admin/analysis/page.tsx'])assert.deepEqual(t.predecessorRead(p),lineCompactPrior(p),p);
});
test('compact Integrity rejects unknown bytes/files, rewritten baseline and promotion',()=>{
 for(const p of LINE_COMPACT_PATHS)assert.throws(()=>lineCompactTransition(q=>q===p?Buffer.concat([read(q),Buffer.from('DRIFT')]):read(q)),/unreviewed candidate drift/);
 for(const mutate of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.push({...m.files[0],path:'unknown'}),m=>m.line_send=true,m=>m.v2_promotion=true,m=>m.member_template_promotion=true,m=>m.predecessor_sha256='bad']){
  const m=JSON.parse(read(LINE_COMPACT_MANIFEST));mutate(m);assert.throws(()=>lineCompactTransition(p=>p===LINE_COMPACT_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));}
 assert.throws(()=>lineCompactTransition(p=>p==='docs/operations/evidence/line-final-usability-transition.json'?Buffer.from('{}'):read(p)));
});
