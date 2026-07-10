import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const jiti = require('jiti')(__filename, { interopDefault: true, alias: { '@': path.resolve(path.dirname(__filename), '../src') } });
const { buildCanonicalNarrative } = jiti('../src/lib/canonicalNarrative.ts');

const displayState = {
  todayQuote: '今天真正要看資金是否願意回到電子權值。',
  rawAI: {},
};

const ai = {
  primary_driver: '電子權值資金回流測試',
  market_story: '今天如果只能記住一件事，就是不要先猜個股，先確認電子權值是否帶量接住資金。',
  taiwan_transmission: '美股半導體壓力傳導到台股後，台積電與電子權值能否止穩，是台股能否轉強的第一條線。',
  member_research_note_v2: {
    opening_thesis: {
      title: '電子權值資金回流測試',
      summary: '先看電子權值是否止穩，再看 PCB / AI 供應鏈是否擴散。',
      action: '未看到量能同步前，不追價。',
      risk: '若 2330 無法止穩，今日劇本降級。',
    },
    intraday_time_windows: [
      { time: '09:30', title: '開盤驗證', purpose: '確認 2330、TAIEX、TXF 是否同向', action_note: '先看權值股是否接住賣壓。' },
      { time: '10:30', title: '主線確認', purpose: '確認電子權值是否擴散到同族群', action_note: '再看族群量能是否放大。' },
    ],
    invalidation_conditions: [
      { condition: '2330 跌破早盤低點', meaning: '電子權值沒有接住資金', action_note: '今日不追電子主線。' },
    ],
  },
  intraday_sync_status: {
    windows: { '0930': 'ready', '1030': 'pending' },
    warning: '10:30 尚未同步',
  },
  closing_verification_v2: {
    status: 'pending',
    summary: '等待收盤資料',
  },
};

const pages = ['home', 'today', 'war-room', 'member-note', 'opportunities'].map((page) => ({
  page,
  narrative: buildCanonicalNarrative({ displayState, ai, memberResearchNoteV2: ai.member_research_note_v2 }),
}));

const base = pages[0].narrative;
for (const item of pages.slice(1)) {
  assert.equal(item.narrative.today_focus.summary, base.today_focus.summary, item.page + ' today_focus.summary differs');
  assert.equal(item.narrative.today_script.headline, base.today_script.headline, item.page + ' today_script.headline differs');
  assert.equal(item.narrative.decision_lifecycle.question.question, base.decision_lifecycle.question.question, item.page + ' decision question differs');
  assert.deepEqual(item.narrative.failure_triggers, base.failure_triggers, item.page + ' failure_triggers differ');
}

console.log(JSON.stringify({
  ok: true,
  pages: pages.map((item) => item.page),
  today_focus_summary: base.today_focus.summary,
  today_script_headline: base.today_script.headline,
  decision_question: base.decision_lifecycle.question.question,
  failure_triggers_count: base.failure_triggers.length,
}, null, 2));
