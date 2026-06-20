import { supabase } from '@/lib/supabase';

/**
 * Seed script: insert a sample report into the reports table.
 * Run this by importing and calling seedSampleReport() from browser console
 * or by executing it inside a one-off edge function.
 */

const seedData = {
  report_date: '2026-05-26',
  summary: '全球市場情緒偏向正面，AI與半導體族群持續受關注，但美元走強與美債殖利率上升帶來一定壓力。',
  market_bias: '震盪偏多',
  confidence_score: 75,
  confidence_label: '震盪偏多',
  can_watch: ['AI / 半導體', 'ETF', '大型權值股'],
  avoid_today: ['追高', '當沖', 'All in 單一股票'],
  fear_greed: 62,
  fear_greed_summary: '市場情緒偏樂觀，但過熱時容易震盪，今天不適合太激進',
  vix: 17.8,
  vix_summary: '市場恐慌不高，短線波動可能較穩定',
  nasdaq_change: 1.25,
  sp500_change: 0.82,
  sox_change: 2.1,
  taiex_futures_change: 0.65,
  dxy: 104.3,
  us_bond_yield: 4.42,
  gold_price: 2365.5,
  oil_price: 78.2,
  btc_price: 68200,
  risk_factors_json: [
    { title: '美元走強', level: 'medium', description: '美元指數 104.3，外資可能暫時偏保守，台股電子股留意震盪' },
    { title: '美債殖利率上升', level: 'medium', description: '10 年債 4.42%，借錢成本變貴，科技股估值容易被壓抑' },
    { title: '地緣政治風險', level: 'low', description: '中東與亞洲地緣情勢持續觀察，對台股影響暫時有限' },
  ],
  watch_sectors_json: [
    { sector: 'AI / 半導體', direction: '偏多', reason: 'Nvidia 帶動，AI 伺服器需求強勁，趨勢延續' },
    { sector: '金融', direction: '中性', reason: '美債利率影響下偏保守，觀望為主' },
    { sector: '航運', direction: '中性', reason: '油價波動影響成本，暫時沒有明確方向' },
    { sector: 'ETF', direction: '偏多', reason: '大盤震盪時 ETF 是較穩的選擇' },
  ],
  focus_stock_json: [
    { group: 'AI 伺服器', direction: '偏多', reason: 'Nvidia 財報與 AI 需求帶動，相關族群持續活躍' },
    { group: '台積電', direction: '偏多', reason: 'ADR 連動，先進製程需求穩定' },
  ],
  tomorrow_watch_json: [
    { name: '美國 CPI 數據', reason: '通膨數據影響 Fed 利率預期，進而影響科技股估值' },
    { name: 'Nvidia 財報', reason: 'AI 產業風向球，影響台股 AI 供應鏈情緒' },
    { name: '外資期貨動向', reason: '影響台股開盤氣氛與權值股走勢' },
    { name: '美債殖利率變化', reason: '資金成本變動，影響外資操作節奏' },
  ],
  global_events_json: [
    {
      source: 'Nvidia AI 需求',
      event: 'AI 伺服器需求持續成長，市場關注度高',
      taiwanImpact: '台積電、聯發科、散熱等 AI 供應鏈可能受市場關注',
      beginnerTip: 'AI 類股可能偏強，但不要追高，等拉回再觀察',
      relatedSector: 'AI / 半導體',
    },
    {
      source: '美債殖利率上升',
      event: '10 年公債殖利率升至 4.42%，借錢成本變貴',
      taiwanImpact: '科技股估值壓力，台股電子股早上可能震盪',
      beginnerTip: '利率升高對成長股不利，新手今天觀望為主，不要急著進場',
      relatedSector: '金融 / 電子',
    },
    {
      source: '美元指數走強',
      event: 'DXY 站上 104.3，美元相對強勢',
      taiwanImpact: '外資可能暫時偏保守，台股電子出口股留意',
      beginnerTip: '美元強不代表台股一定跌，但短線電子股可能整理，先觀察',
      relatedSector: '電子 / 出口',
    },
  ],
  ai_strategy_json: {
    conservative: '今天先觀察 ETF 與大型股，保留較多現金，等趨勢明朗再進場',
    aggressive: '可留意 AI 與半導體趨勢，但不要重押單一股票，保留現金應對震盪',
    overall_advice: '新手今天適合小額分批觀察，不適合重壓單一股票，也不建議追高',
    risk_warning: '新手不建議融資、槓桿或當沖，先用現金慢慢學習最安全',
  },
  important_news_json: [
    {
      title: 'Nvidia 帶動美股科技股走強，市場關注 AI 伺服器需求',
      summary: 'Nvidia 的強勁表現推升美股科技股，AI 伺服器需求成為市場焦點，帶動半導體相關族群情緒偏多',
      impact: '可能影響台股電子權值股與 AI 伺服器族群的盤前情緒',
      sectors: ['AI', '半導體', '伺服器'],
    },
    {
      title: '美國 10 年期公債殖利率攀升至 4.42%',
      summary: '美債殖利率上升可能增加資金成本，影響外資操作節奏與市場波動',
      impact: '可能影響外資操作節奏與台股大盤情緒',
      sectors: ['金融', '電子權值股'],
    },
    {
      title: '中國與香港股市因 AI 樂觀情緒上漲',
      summary: '中國及香港股市受 AI 題材推動上漲，帶動區域科技股表現，增強市場信心',
      impact: '可能影響台股相關族群情緒與外資動向',
      sectors: ['AI', '半導體'],
    },
  ],
  yesterday_summary: '昨日 AI 判斷震盪偏多，市場開高震盪、AI 類股續強，趨勢判斷大致符合。',
  today_summary: '今日市場持續震盪偏多，AI 與半導體仍是觀察重點，美元與美債帶來壓力需留意。',
};

export async function seedSampleReport(): Promise<void> {
  const { error } = await supabase.from('reports').upsert(seedData, { onConflict: 'report_date' });

  if (error) {
    console.error('Seed failed:', error.message);
    throw new Error(`Seed failed: ${error.message}`);
  }

  console.log('✅ Seed report inserted for 2026-05-26');
}

export default seedSampleReport;