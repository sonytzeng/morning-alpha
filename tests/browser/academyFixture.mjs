// Original synthetic test labels only. Never import this module from src or the harness entry.
export const course = {
  version: 'synthetic-v1', title: '介面驗收用課程', notice: '原創合成資料，不含私人教材或真實市場資料。',
  chapters: ['candle', 'trend', 'zones', 'bullSteps', 'bearSteps', 'cycle', 'risk'].map((kind, i) => ({
    id: `chapter-${i}`, title: `示範章節 ${i + 1}`, goal: '練習操作介面與核對圖解。', paragraphs: ['這是一段原創合成文字，僅供介面驗收。'],
    example: '這是合成示例，不是真實交易。', mistakes: ['不要把示意圖當成預測。'], sourceNote: '原創合成 fixture，無講師研究。', diagram: { kind, caption: '只驗證互動與可讀性。' },
    questions: i === 0 ? [
      { id: 'q-choice', prompt: '選擇第一個示範選項', choices: ['示範選項 A', '示範選項 B'], correctIndex: 0, explanation: '合成測試的預設答案是 A。' },
      { id: 'q-order', kind: 'order', prompt: '將 A 放在 B 前面', choices: ['步驟 B', '步驟 A'], order: ['步驟 A', '步驟 B'], correctIndex: 0, explanation: '合成順序為 A、B。' },
      { id: 'q-diagram', kind: 'diagram', prompt: '看圖後選擇示範標記', choices: ['圖解 A', '圖解 B'], correctIndex: 0, explanation: '此處只驗證圖解題控制。' },
      { id: 'q-zone', kind: 'zone', prompt: '選擇示範區域', choices: ['支撐區', '壓力區'], correctIndex: 0, explanation: '這是合成區域題，不表示任何交易條件。' },
    ] : [],
  })),
};
