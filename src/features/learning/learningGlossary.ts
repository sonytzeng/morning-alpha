export type LearningCategory = '基礎財務' | '交易觀念' | '量價技術' | '籌碼市場' | 'Morning Alpha';

export type LearningTerm = {
  slug: string;
  term: string;
  aliases: string[];
  category: LearningCategory;
  plainExplanation: string;
  example: string;
  whyItMatters: string;
  misconception: string;
  riskReminder: string;
  source: { label: string; url: string };
};

export const LEARNING_CATEGORIES: LearningCategory[] = ['基礎財務', '交易觀念', '量價技術', '籌碼市場', 'Morning Alpha'];

const TWSE_QA = 'https://investoredu.twse.com.tw/pages/TWSE_InvestmentQA.aspx?ID=1';
const TWSE_LEARN = 'https://investoredu.twse.com.tw/Pages/TWSE.aspx';
const TWSE_MARKET = 'https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html';
const TWSE_INSTITUTIONAL = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=html';
const TWSE_INSTITUTIONAL_STOCK = 'https://www.twse.com.tw/fund/T86?date=&response=html';
const MOPS = 'https://mops.twse.com.tw/';
const MOPS_FINANCE = 'https://mopsfin.twse.com.tw/';
const TPEX_DAY_TRADING = 'https://www.tpex.org.tw/zh-tw/mainboard/trading/day-trading/rules.html';

export const LEARNING_TERMS: LearningTerm[] = [
  {
    slug: 'price-earnings-ratio', term: '本益比', aliases: ['P/E', 'PE'], category: '基礎財務',
    plainExplanation: '股價相對於公司每股獲利的倍數，用來觀察市場願意為一元獲利付多少錢。',
    example: '股價 100 元、近四季 EPS 5 元，本益比約為 20 倍。',
    whyItMatters: '可協助比較同產業公司目前的價格是否偏高或偏低。',
    misconception: '本益比低不一定便宜，也可能反映市場預期獲利下降。',
    riskReminder: '景氣循環股的獲利高點常讓本益比看起來特別低，不能單獨使用。',
    source: { label: '證交所投資人知識網', url: TWSE_QA },
  },
  {
    slug: 'price-to-book-ratio', term: '股價淨值比', aliases: ['P/B', 'PBR'], category: '基礎財務',
    plainExplanation: '股價相對於每股淨值的倍數，常用來觀察資產型或金融公司的評價。',
    example: '股價 60 元、每股淨值 40 元，股價淨值比為 1.5 倍。',
    whyItMatters: '能補充本益比看不到的資產價值資訊。',
    misconception: '低於一倍不代表一定會回到淨值，資產品質仍然重要。',
    riskReminder: '帳面資產可能減損，也可能難以快速變現。',
    source: { label: '證交所個股評價資料', url: TWSE_MARKET },
  },
  {
    slug: 'dividend-yield', term: '殖利率', aliases: ['股息殖利率', '現金殖利率'], category: '基礎財務',
    plainExplanation: '一年現金股利相對於目前股價的比例。',
    example: '股價 50 元、現金股利 2 元，殖利率約為 4%。',
    whyItMatters: '可估算只看現金股利時的回報水準。',
    misconception: '高殖利率不等於低風險，也不保證明年股利相同。',
    riskReminder: '股價下跌會讓殖利率被動升高，必須同時檢查獲利與配息能力。',
    source: { label: '證交所個股評價資料', url: TWSE_MARKET },
  },
  {
    slug: 'eps', term: 'EPS', aliases: ['每股盈餘', '每股稅後盈餘'], category: '基礎財務',
    plainExplanation: '公司稅後獲利換算到每一股的金額。',
    example: '公司全年 EPS 8 元，代表平均每股對應 8 元稅後獲利。',
    whyItMatters: '是觀察公司獲利能力與計算本益比的重要基礎。',
    misconception: 'EPS 增加不一定來自本業，也可能有一次性收益。',
    riskReminder: '應搭配營收、毛利率與現金流一起判讀。',
    source: { label: '公開資訊觀測站財務比較', url: MOPS_FINANCE },
  },
  {
    slug: 'revenue', term: '營收', aliases: ['營業收入', '月營收'], category: '基礎財務',
    plainExplanation: '公司銷售商品或服務取得的收入，尚未扣除成本與費用。',
    example: '月營收年增 20%，表示本月收入比去年同月增加兩成。',
    whyItMatters: '可較早觀察需求與公司規模是否成長。',
    misconception: '營收成長不代表獲利一定成長。',
    riskReminder: '促銷、匯率或併購都可能影響營收，需看成長來源。',
    source: { label: '公開資訊觀測站', url: MOPS },
  },
  {
    slug: 'gross-margin', term: '毛利率', aliases: ['營業毛利率'], category: '基礎財務',
    plainExplanation: '營收扣掉直接成本後，剩餘毛利占營收的比例。',
    example: '營收 100 元、直接成本 60 元，毛利率為 40%。',
    whyItMatters: '可觀察公司的定價能力、產品組合與成本壓力。',
    misconception: '毛利率高不代表最後一定賺錢，還有研發與管理費用。',
    riskReminder: '不同產業毛利結構差異很大，不宜跨產業直接比較。',
    source: { label: '公開資訊觀測站財務比較', url: MOPS_FINANCE },
  },
  {
    slug: 'roe', term: 'ROE', aliases: ['股東權益報酬率'], category: '基礎財務',
    plainExplanation: '公司運用股東投入資本創造獲利的效率。',
    example: 'ROE 15% 可理解為每 100 元股東權益，當期約產生 15 元獲利。',
    whyItMatters: '能協助觀察經營效率是否長期穩定。',
    misconception: 'ROE 越高不一定越好，高負債也可能把 ROE 推高。',
    riskReminder: '需搭配負債比例與一次性損益判讀。',
    source: { label: '公開資訊觀測站財務比較', url: MOPS_FINANCE },
  },
  {
    slug: 'long', term: '做多', aliases: ['看多', '多單'], category: '交易觀念',
    plainExplanation: '先買進，期待價格上漲後再賣出。',
    example: '以 50 元買進，之後 55 元賣出，價差為正。',
    whyItMatters: '這是最常見的股票交易方向。',
    misconception: '看好公司不代表任何價格都適合買進。',
    riskReminder: '價格也可能下跌，進場前仍需設定可承受風險。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'short-selling', term: '放空', aliases: ['做空', '空單'], category: '交易觀念',
    plainExplanation: '先借股票賣出，期待價格下跌後買回歸還。',
    example: '以 100 元賣出借來的股票，之後 90 元買回。',
    whyItMatters: '了解市場下跌時的交易與避險機制。',
    misconception: '放空不是單純按下賣出，還涉及借券、回補與費用。',
    riskReminder: '股價上漲的理論損失沒有上限，且可能遇到無券可回補。',
    source: { label: '證交所線上學習', url: 'https://investoredu.twse.com.tw/pages/TWSE_OnlineLearning2_1.aspx?Page=2' },
  },
  {
    slug: 'margin-financing', term: '融資', aliases: ['融資買進'], category: '交易觀念',
    plainExplanation: '向券商借部分資金買股票，屬於槓桿交易。',
    example: '自備部分款項，其餘由券商融資，之後需支付利息。',
    whyItMatters: '融資變化常被用來觀察市場槓桿與散戶風險偏好。',
    misconception: '融資不是免費增加購買力。',
    riskReminder: '股價下跌可能被追繳，損失速度會放大。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'securities-lending', term: '融券', aliases: ['融券賣出'], category: '交易觀念',
    plainExplanation: '向券商借股票賣出，之後再買回股票歸還。',
    example: '融券賣出後，必須在規定期限內回補。',
    whyItMatters: '是台股常見的放空方式之一。',
    misconception: '融券餘額增加不一定代表股價一定會跌。',
    riskReminder: '可能遇到強制回補、券源不足與借券成本。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'day-trading', term: '當沖', aliases: ['現股當沖', '日內交易'], category: '交易觀念',
    plainExplanation: '同一交易日完成同一檔股票的買進與賣出。',
    example: '上午買進、下午收盤前賣出，不把部位留到隔天。',
    whyItMatters: '可理解短線交易的成本、速度與風險。',
    misconception: '不留倉不等於低風險，也不代表容易獲利。',
    riskReminder: '波動、滑價與交易成本會快速累積。',
    source: { label: '櫃買中心當沖交易專區', url: TPEX_DAY_TRADING },
  },
  {
    slug: 'stop-loss', term: '停損', aliases: ['止損'], category: '交易觀念',
    plainExplanation: '當原本判斷被證明錯誤時，依計畫限制損失。',
    example: '買進後跌破事先設定的失效條件，停止原計畫。',
    whyItMatters: '避免一次錯誤擴大成難以承受的損失。',
    misconception: '停損不是預測最低點，而是管理錯誤。',
    riskReminder: '停損條件若過度隨意，可能造成頻繁進出。',
    source: { label: '證交所投資風險專區', url: TWSE_LEARN },
  },
  {
    slug: 'chasing-price', term: '追價', aliases: ['追高', '追漲'], category: '交易觀念',
    plainExplanation: '價格已快速上漲後，因害怕錯過而急著買進。',
    example: '股票突然拉高時，未確認量價與失效條件就立即買入。',
    whyItMatters: '追價常讓進場成本與短線風險同時提高。',
    misconception: '強勢股不是不能買，而是要先確認條件與風險。',
    riskReminder: '高波動時容易買在短線情緒高點。',
    source: { label: '證交所投資風險專區', url: TWSE_LEARN },
  },
  {
    slug: 'position-size', term: '部位', aliases: ['持倉', '曝險'], category: '交易觀念',
    plainExplanation: '目前投入某檔股票或某種方向的資金比例。',
    example: '把可投資資金的一部分放在單一股票，就是該股票的部位。',
    whyItMatters: '同一個判斷，部位大小會決定實際風險。',
    misconception: '看對方向不代表可以重押。',
    riskReminder: '單一方向過度集中會放大意外事件的影響。',
    source: { label: '證交所投資風險專區', url: TWSE_LEARN },
  },
  {
    slug: 'trading-volume', term: '成交量', aliases: ['量能', '交易量'], category: '量價技術',
    plainExplanation: '一段時間內完成交易的股數，反映市場參與程度。',
    example: '股價上漲且成交量同步放大，代表更多資金參與。',
    whyItMatters: '能協助判斷價格變化是否獲得資金支持。',
    misconception: '爆量不一定看多，也可能是大量賣壓。',
    riskReminder: '需同時看價格方向、位置與後續延續性。',
    source: { label: '證交所投資人知識網', url: TWSE_QA },
  },
  {
    slug: 'moving-average', term: '均線', aliases: ['移動平均線', 'MA'], category: '量價技術',
    plainExplanation: '把一段期間的收盤價取平均，形成觀察趨勢的線。',
    example: '五日均線反映近五個交易日平均收盤價。',
    whyItMatters: '可快速觀察短、中期價格趨勢與市場成本。',
    misconception: '站上均線不代表之後一定上漲。',
    riskReminder: '均線來自過去價格，遇到盤整容易反覆失真。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'support', term: '支撐', aliases: ['支撐區'], category: '量價技術',
    plainExplanation: '價格下跌到某個區域時，買盤較可能增加的位置。',
    example: '股價多次回到同一區域後止跌，該區可能形成支撐。',
    whyItMatters: '可用來規劃觀察點與失效條件。',
    misconception: '支撐不是保證不會跌破的地板。',
    riskReminder: '跌破後若沒有快速收回，原支撐可能失效。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'resistance', term: '壓力', aliases: ['壓力區'], category: '量價技術',
    plainExplanation: '價格上漲到某個區域時，賣壓較可能增加的位置。',
    example: '股價多次接近前高後回落，前高附近可能形成壓力。',
    whyItMatters: '可協助評估上方空間與追價風險。',
    misconception: '碰到壓力不代表必然反轉。',
    riskReminder: '真正突破需要觀察量能與後續是否站穩。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'breakout', term: '突破', aliases: ['突破壓力', '過前高'], category: '量價技術',
    plainExplanation: '價格離開原本整理區或越過重要壓力。',
    example: '股價帶量越過前高，之後仍站穩突破區。',
    whyItMatters: '常被用來確認趨勢是否開始延續。',
    misconception: '盤中短暫越過就算有效突破。',
    riskReminder: '無量或快速跌回原區間，可能是假突破。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'divergence', term: '背離', aliases: ['價量背離', '指標背離'], category: '量價技術',
    plainExplanation: '價格與成交量或其他觀察指標沒有同方向變化。',
    example: '指數創高，但成交量與多數股票沒有同步增強。',
    whyItMatters: '可提醒表面走勢背後的支持力道可能不足。',
    misconception: '出現背離就代表馬上反轉。',
    riskReminder: '背離可延續很久，仍需等待真正的失效訊號。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'price-volume', term: '量價', aliases: ['量價關係', '價量'], category: '量價技術',
    plainExplanation: '把價格方向與成交量變化放在一起看，而不是只看漲跌。',
    example: '上漲有量、拉回量縮，和上漲無量代表的市場參與程度不同。',
    whyItMatters: '可判斷走勢是否有實際資金支持。',
    misconception: '任何放量上漲都一定健康。',
    riskReminder: '高檔爆量也可能是換手或賣壓，需看後續價格。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'foreign-investors', term: '外資', aliases: ['外陸資', '外國機構投資人'], category: '籌碼市場',
    plainExplanation: '在台灣市場交易的外國與陸資投資人。',
    example: '外資買賣超資料顯示當日買進與賣出的差額。',
    whyItMatters: '外資交易規模大，常影響大型權值股與指數。',
    misconception: '外資買超不保證隔天上漲。',
    riskReminder: '買賣超可能包含避險與跨市場配置，不宜單獨解讀。',
    source: { label: '證交所三大法人統計', url: TWSE_INSTITUTIONAL },
  },
  {
    slug: 'investment-trusts', term: '投信', aliases: ['本國投信', '投資信託基金'], category: '籌碼市場',
    plainExplanation: '由國內投信公司管理基金所形成的交易力量。',
    example: '投信連續買超某族群，代表基金資金持續配置。',
    whyItMatters: '常用來觀察中小型股或特定族群的資金延續性。',
    misconception: '投信買超就等於公司基本面一定變好。',
    riskReminder: '季底作帳或基金申贖也會影響買賣。',
    source: { label: '證交所三大法人統計', url: TWSE_INSTITUTIONAL },
  },
  {
    slug: 'dealers', term: '自營商', aliases: ['券商自營部'], category: '籌碼市場',
    plainExplanation: '證券商用自有資金交易，統計常分自行買賣與避險。',
    example: '自營商避險賣超，可能與權證或衍生商品部位有關。',
    whyItMatters: '可避免把所有自營商買賣都誤認成方向性看法。',
    misconception: '自營商賣超一定代表券商看空。',
    riskReminder: '避險交易的目的與一般投資不同，需分項觀察。',
    source: { label: '證交所三大法人統計', url: TWSE_INSTITUTIONAL },
  },
  {
    slug: 'institutional-investors', term: '三大法人', aliases: ['法人'], category: '籌碼市場',
    plainExplanation: '台股常把外資、投信與自營商合稱三大法人。',
    example: '盤後可查看三類法人當日的買進、賣出與買賣超。',
    whyItMatters: '可觀察大型資金在市場中的主要流向。',
    misconception: '三類法人永遠會站在同一方向。',
    riskReminder: '合計數字會掩蓋三類法人目的不同，應拆開看。',
    source: { label: '證交所個股法人統計', url: TWSE_INSTITUTIONAL_STOCK },
  },
  {
    slug: 'market-operator', term: '主力', aliases: ['大戶', '特定大額資金'], category: '籌碼市場',
    plainExplanation: '市場對能明顯影響個股短期交易的大額資金之俗稱，不是單一正式身分。',
    example: '集中成交或特定分點變化，常被市場稱為主力籌碼。',
    whyItMatters: '理解這是市場用語，可避免把模糊稱呼當成確定事實。',
    misconception: '看到分點集中就能知道是誰、下一步要做什麼。',
    riskReminder: '公開資料無法完整辨識實際交易人，不應據此保證方向。',
    source: { label: '證交所投資人知識網', url: TWSE_LEARN },
  },
  {
    slug: 'confirmation-condition', term: '成立條件', aliases: ['確認條件', '驗證條件'], category: 'Morning Alpha',
    plainExplanation: '在繼續觀察或執行原劇本前，必須由市場證據確認的條件。',
    example: '代表股與大盤方向一致，而且成交量開始擴散。',
    whyItMatters: '把「看好」轉成可以等待與驗證的具體標準。',
    misconception: '時間到了就代表條件成立。',
    riskReminder: '沒有完成的市場證據就不能把狀態升級為成立。',
    source: { label: 'Morning Alpha 使用說明', url: '/faq' },
  },
  {
    slug: 'invalidation-condition', term: '失效條件', aliases: ['取消條件', '停止條件'], category: 'Morning Alpha',
    plainExplanation: '市場出現什麼證據時，代表原本判斷不再適用。',
    example: '主線代表股跌破關鍵位置，且族群沒有同步承接。',
    whyItMatters: '讓使用者知道何時應停止原劇本，而不是一路找理由。',
    misconception: '股價短暫下跌就一定失效。',
    riskReminder: '必須依報告列出的實際條件判斷，不能事後任意改標準。',
    source: { label: 'Morning Alpha 使用說明', url: '/faq' },
  },
  {
    slug: 'relative-market', term: '相對大盤', aliases: ['相對強弱', '相對表現'], category: 'Morning Alpha',
    plainExplanation: '把個股或族群的表現，和同時間的大盤表現相比。',
    example: '大盤下跌 1%，某股只跌 0.2%，可說它相對大盤較強。',
    whyItMatters: '能分辨個股走勢是自身較強，還是只是跟著市場波動。',
    misconception: '相對強就等於股價正在上漲。',
    riskReminder: '相對強弱會隨時間改變，仍需搭配量價與市場狀態。',
    source: { label: '證交所市場資料', url: 'https://www.twse.com.tw/zh/trading/historical/mi-index.html' },
  },
  {
    slug: 'beneficiary-stock', term: '受惠股', aliases: ['題材受惠股', '受影響股票'], category: 'Morning Alpha',
    plainExplanation: '有明確證據顯示可能受到事件或產業變化影響，且仍需盤中驗證的股票。',
    example: '事件、產業、供應鏈與公司關係都有來源，才會進入候選名單。',
    whyItMatters: '區分有證據的候選股與只靠關鍵字聯想的股票。',
    misconception: '被列為受惠股就代表一定上漲或可以直接買進。',
    riskReminder: '候選關係仍需成立條件，失效時必須停止觀察。',
    source: { label: 'Morning Alpha 使用說明', url: '/faq' },
  },
  {
    slug: 'evidence-coverage', term: '證據覆蓋率', aliases: ['Evidence Coverage', '證據完整度'], category: 'Morning Alpha',
    plainExplanation: '報告中的重要判斷，有多少能連回已保存的資料或來源。',
    example: '事件、傳導、代表股與驗證條件都有來源，覆蓋才算完整。',
    whyItMatters: '協助辨識內容是有資料支持，還是只有推測。',
    misconception: '高覆蓋率等於預測一定正確。',
    riskReminder: '覆蓋率衡量證據完整，不是獲利保證或勝率。',
    source: { label: 'Morning Alpha 使用說明', url: '/faq' },
  },
  {
    slug: 'decision-snapshot', term: '決策快照', aliases: ['Decision Snapshot', '當日決策版本'], category: 'Morning Alpha',
    plainExplanation: '在特定時間保存的正式判斷版本，包含狀態、證據與下一個確認點。',
    example: '07:30 的盤前判斷與 14:10 的收盤驗證是不同時間的紀錄。',
    whyItMatters: '避免事後改寫原判斷，也能追蹤當天如何驗證。',
    misconception: '後來更新的結果可以反過來當成早上的已知資訊。',
    riskReminder: '應查看報告日期、產生時間與資料時間是否一致。',
    source: { label: 'Morning Alpha 使用說明', url: '/faq' },
  },
];

const normalize = (value: string) => value.trim().toLocaleLowerCase('zh-Hant-TW');

export function findLearningTerm(slugOrTerm: string): LearningTerm | undefined {
  const query = normalize(slugOrTerm);
  return LEARNING_TERMS.find((item) => item.slug === query
    || normalize(item.term) === query
    || item.aliases.some((alias) => normalize(alias) === query));
}

export function filterLearningTerms(query: string, category: LearningCategory | '全部'): LearningTerm[] {
  const normalizedQuery = normalize(query);
  return LEARNING_TERMS.filter((item) => {
    const matchesCategory = category === '全部' || item.category === category;
    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;
    return [item.term, item.category, item.plainExplanation, ...item.aliases]
      .map(normalize)
      .join(' ')
      .includes(normalizedQuery);
  });
}
