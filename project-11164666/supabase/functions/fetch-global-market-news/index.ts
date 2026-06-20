import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ===== fetch-global-market-news V8.2 =====
// V8.2: Relax scoring threshold from 70 to 60, increase taiwan weight to 0.5,
//       add AI core bonus (+8) and floor scores for semiconductor/AI/Nvidia/TSMC news

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

// ============================================================
// SECTION 1: BLACKLIST
// ============================================================
const BLACKLIST_KEYWORDS = [
  "401k", "401(k)", "roth ira", "roth 401", "ira contribution",
  "social security", "retirement savings", "retirement account", "retirement fund",
  "pension fund", "pension plan", "defined benefit", "annuity",
  "personal finance", "financial planning", "estate planning",
  "medicare", "medicaid", "social security benefit",
  "credit card", "credit score", "credit report", "credit rating personal",
  "mortgage rate", "mortgage payment", "home loan", "auto loan", "student loan",
  "personal loan", "payday loan", "debt consolidation",
  "savings account", "bank account", "high yield savings",
  "insurance tips", "life insurance", "car insurance", "home insurance",
  "health insurance premium", "term life", "whole life insurance",
  "how to invest", "beginner investor", "investment for beginners",
  "best etf to buy", "top etf", "best funds to buy", "dividend etf",
  "safe investments", "where to invest", "how to save",
  "etf promotion", "etf comparison", "etf guide",
  "consumer spending guide", "budgeting tips", "frugal living",
  "meme coin", "shitcoin", "pump and dump", "rug pull",
  "how to negotiate salary", "job interview tips", "resume tips",
  "dividend income guide", "retirement fund", "default fund",
  "tax tips", "loan rate", "student loan",
  "consumer guide", "credit card", "retirement",
];

// ============================================================
// SECTION 2: HIGH-VALUE KEYWORDS
// ============================================================
const HIGH_VALUE_KEYWORDS = [
  "nvidia", "nvda", "jensen huang",
  "computex", "computex 2025", "computex 2026",
  "tsmc", "taiwan semiconductor", "台積電",
  "semiconductor", "chip", "wafer", "foundry",
  "ai chip", "ai server", "data center", "ai infrastructure",
  "blackwell", "gb200", "gb300",
  "cowos", "hbm", "memory", "advanced packaging",
  "sox", "nasdaq", "s&p 500", "s&p500", "sp500",
  "fed", "federal reserve", "fomc", "jerome powell", "powell",
  "us treasury", "treasury", "bond yield", "10-year yield", "yield curve",
  "dollar", "dxy", "usd", "us dollar", "taiwan dollar",
  "vix", "volatility index",
  "crude oil", "oil price", "wti", "brent", "opec",
  "china policy", "china economy", "china tech", "beijing",
  "tariff", "trade war", "trade tension", "export control", "sanctions",
  "inflation", "cpi", "ppi", "gdp", "nonfarm payroll", "jobs report",
  "interest rate", "rate hike", "rate cut", "rate decision",
  "apple", "iphone", "microsoft", "google", "alphabet", "meta", "amazon", "tesla",
  "earnings", "revenue", "guidance", "profit", "quarterly",
  "merger", "acquisition", "buyback", "ipo", "stock split",
  "hon hai", "foxconn", "quanta", "compal", "wistron", "pegatron",
  "delta electronics", "mediatek", "novatek", "realtek", "largan",
  "arm holdings", "arm ltd",
];

// ============================================================
// SECTION 3: TAIWAN SUPPLY CHAIN MAPPING
// ============================================================
const TAIWAN_SUPPLY_CHAIN_MAP = {
  "nvidia": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274", "6669"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊", "祥碩"],
  },
  "nvda": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "ai server": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "data center": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "blackwell": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "gb200": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "gb300": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "tsmc": {
    symbols: ["2330", "3443", "3661", "3711", "2449"],
    names: ["台積電", "創意", "世芯-KY", "日月光投控", "京元電子"],
  },
  "taiwan semiconductor": {
    symbols: ["2330", "3443", "3661", "3711", "2449"],
    names: ["台積電", "創意", "世芯-KY", "日月光投控", "京元電子"],
  },
  "台積電": {
    symbols: ["2330", "3443", "3661", "3711", "2449"],
    names: ["台積電", "創意", "世芯-KY", "日月光投控", "京元電子"],
  },
  "cowos": {
    symbols: ["2330", "3711", "2449", "2467", "3131"],
    names: ["台積電", "日月光投控", "京元電子", "志聖", "弘塑"],
  },
  "advanced packaging": {
    symbols: ["2330", "3711", "2449", "2467", "3131"],
    names: ["台積電", "日月光投控", "京元電子", "志聖", "弘塑"],
  },
  "hbm": {
    symbols: ["2408", "2344", "8299", "3260"],
    names: ["南亞科", "華邦電", "群聯", "威剛"],
  },
  "memory": {
    symbols: ["2408", "2344", "8299", "3260"],
    names: ["南亞科", "華邦電", "群聯", "威剛"],
  },
  "apple": {
    symbols: ["2330", "3008", "2317", "3406"],
    names: ["台積電", "大立光", "鴻海", "玉晶光"],
  },
  "iphone": {
    symbols: ["2330", "3008", "2317", "3406"],
    names: ["台積電", "大立光", "鴻海", "玉晶光"],
  },
  "mac": {
    symbols: ["2330", "3008", "2317", "3406"],
    names: ["台積電", "大立光", "鴻海", "玉晶光"],
  },
  "tesla": {
    symbols: ["2308", "1536", "3665"],
    names: ["台達電", "和大", "貿聯-KY"],
  },
  "ev": {
    symbols: ["2308", "1536", "3665"],
    names: ["台達電", "和大", "貿聯-KY"],
  },
  "fed": {
    symbols: ["2881", "2882", "2883", "2884", "2885", "2886", "2887", "2888", "2889", "2890", "2891", "2892"],
    names: ["富邦金", "國泰金", "開發金", "玉山金", "元大金", "兆豐金", "台新金", "新光金", "永豐金", "國票金", "中信金", "第一金"],
  },
  "federal reserve": {
    symbols: ["2881", "2882", "2883", "2884", "2885", "2886", "2887", "2888", "2889", "2890", "2891", "2892"],
    names: ["富邦金", "國泰金", "開發金", "玉山金", "元大金", "兆豐金", "台新金", "新光金", "永豐金", "國票金", "中信金", "第一金"],
  },
  "us treasury": {
    symbols: ["2881", "2882", "2883", "2884", "2885", "2886", "2887", "2888", "2889", "2890", "2891", "2892"],
    names: ["富邦金", "國泰金", "開發金", "玉山金", "元大金", "兆豐金", "台新金", "新光金", "永豐金", "國票金", "中信金", "第一金"],
  },
  "bond yield": {
    symbols: ["2881", "2882", "2883", "2884", "2885", "2886", "2887", "2888", "2889", "2890", "2891", "2892"],
    names: ["富邦金", "國泰金", "開發金", "玉山金", "元大金", "兆豐金", "台新金", "新光金", "永豐金", "國票金", "中信金", "第一金"],
  },
  "dollar": {
    symbols: ["2881", "2882", "2883", "2884", "2885", "2886", "2887", "2888", "2889", "2890", "2891", "2892"],
    names: ["富邦金", "國泰金", "開發金", "玉山金", "元大金", "兆豐金", "台新金", "新光金", "永豐金", "國票金", "中信金", "第一金"],
  },
  "oil": {
    symbols: ["6505", "1301", "1303", "1326", "2615", "2618", "2603", "2609"],
    names: ["台塑", "台塑", "南亞", "台化", "萬海", "長榮航", "長榮", "陽明"],
  },
  "crude": {
    symbols: ["6505", "1301", "1303", "1326", "2615", "2618", "2603", "2609"],
    names: ["台塑", "台塑", "南亞", "台化", "萬海", "長榮航", "長榮", "陽明"],
  },
  "china policy": {
    symbols: ["2330", "2317", "2382", "3231", "1530", "2049", "4536"],
    names: ["台積電", "鴻海", "廣達", "緯創", "工具機", "上銀", "台灣精銳"],
  },
  "tariff": {
    symbols: ["2330", "2317", "2382", "3231", "1530", "2049", "4536", "2603", "2609"],
    names: ["台積電", "鴻海", "廣達", "緯創", "工具機", "上銀", "台灣精銳", "長榮", "陽明"],
  },
  "export control": {
    symbols: ["2330", "2317", "2382", "3231", "1530", "2049"],
    names: ["台積電", "鴻海", "廣達", "緯創", "工具機", "上銀"],
  },
  "semiconductor": {
    symbols: ["2330", "2454", "2379", "4966", "6488", "3264", "6237", "3661"],
    names: ["台積電", "聯發科", "瑞昱", "譜瑞-KY", "環球晶", "欣銓", "驊訊", "世芯-KY"],
  },
  "chip": {
    symbols: ["2330", "2454", "2379", "4966", "6488", "3264", "6237", "3661"],
    names: ["台積電", "聯發科", "瑞昱", "譜瑞-KY", "環球晶", "欣銓", "驊訊", "世芯-KY"],
  },
  "ai chip": {
    symbols: ["2330", "2454", "2379", "4966", "6488", "3264", "6237", "3661"],
    names: ["台積電", "聯發科", "瑞昱", "譜瑞-KY", "環球晶", "欣銓", "驊訊", "世芯-KY"],
  },
  "sox": {
    symbols: ["2330", "2454", "2379", "4966", "6488", "3264", "6237", "3661"],
    names: ["台積電", "聯發科", "瑞昱", "譜瑞-KY", "環球晶", "欣銓", "驊訊", "世芯-KY"],
  },
  "computex": {
    symbols: ["2330", "2317", "2382", "3231", "6669", "3017", "6277", "5274"],
    names: ["台積電", "鴻海", "廣達", "緯創", "緯穎", "奇鋐", "雙鴻", "信驊"],
  },
  "arm holdings": {
    symbols: ["2330", "2454", "2379", "4966", "6488", "3264"],
    names: ["台積電", "聯發科", "瑞昱", "譜瑞-KY", "環球晶", "欣銓"],
  },
  "arm ltd": {
    symbols: ["2330", "2454", "2379", "4966", "6488", "3264"],
    names: ["台積電", "聯發科", "瑞昱", "譜瑞-KY", "環球晶", "欣銓"],
  },
};

// ============================================================
// SECTION 4: TAIWAN KEYWORDS
// ============================================================
const TAIWAN_KEYWORDS = [
  "tsmc", "taiwan semiconductor", "taiwan", "台積電", "台股", "taiex", "twii",
  "hon hai", "foxconn", "mediatek", "novatek", "delta electronics", "asus",
  "acer", "realtek", "silicon motion", "winbond", "largan", "quanta",
  "compal", "wistron", "pegatron", "inventec",
  "semiconductor", "chip", "wafer", "foundry", "hbm", "cowos",
  "advanced packaging", "asml", "sk hynix", "nvda", "nvidia", "amd",
  "sony sensor", "arm", "qualcomm", "apple supply", "iphone", "server supply",
  "ai chip", "ai server", "ai infrastructure", "data center",
  "sox", "philadelphia semiconductor",
  "china tariff", "us china trade", "trade war", "trade tension",
  "federal reserve", "interest rate", "rate cut", "rate hike", "fed",
  "us dollar", "dxy", "usd", "yen", "yuan", "taiwan dollar",
  "treasury yield", "us treasury", "10-year yield", "bond yield",
  "nasdaq", "s&p 500", "s&p500", "sp500", "dow jones",
  "vix", "market fear", "market panic", "market crash",
  "oil price", "crude oil", "wti", "brent", "opec", "energy",
  "computex", "blackwell", "gb200", "gb300",
];

// ============================================================
// SECTION 5: IMPACT KEYWORDS
// ============================================================
const IMPACT_KEYWORDS = [
  "earnings beat", "earnings miss", "revenue beat", "revenue miss",
  "guidance raised", "guidance cut", "profit warning", "downgrade", "upgrade",
  "rate hike", "rate cut", "emergency rate", "fed decision", "fomc meeting",
  "inflation surge", "cpi surge", "gdp miss", "gdp beat", "recession",
  "market crash", "market rally", "selloff", "plunge", "surge", "spike",
  "acquisition", "merger", "ipo", "buyback", "stock split", "takeover",
  "sanctions", "ban", "restriction", "export control", "entity list",
  "supply shortage", "inventory glut", "demand surge", "capacity constraint",
  "record high", "record low", "all-time high", "all-time low",
  "layoff", "restructuring", "bankrupt", "default", "downgrade",
  "taiwan strait", "military", "geopolitic", "war risk", "conflict",
  "tsmc halt", "tsmc stop", "tsmc suspend", "tsmc cut", "tsmc miss",
  "nvidia halt", "nvidia ban", "nvidia export", "nvidia restriction",
  "earthquake", "typhoon", "flood", "fire", "disaster",
];

// ============================================================
// SECTION 6: CATEGORY DETECTION
// ============================================================
const CATEGORY_MAP = {
  "Semiconductor": [
    "semiconductor", "chip", "wafer", "foundry", "sox", "tsmc", "taiwan semiconductor",
    "asml", "lam research", "applied materials", "kla", "sk hynix", "micron",
    "intel", "amd", "silicon wafer", "hbm", "cowos", "advanced packaging",
    "chipmaker", "3nm", "2nm", "5nm", "7nm", "nm process", "process node",
  ],
  "AI": [
    "artificial intelligence", "ai chip", "ai server", "ai model", "llm",
    "openai", "anthropic", "ai demand", "ai infrastructure", "generative ai",
    "nvidia", "nvda", "ai data center", "machine learning", "deep learning",
    "neural network", "gpu", "ai accelerator", "ai training", "ai inference",
    "blackwell", "gb200", "gb300", "computex",
  ],
  "Fed": [
    "federal reserve", "fed reserve", "fomc", "jerome powell", "rate hike",
    "rate cut", "interest rate", "fed decision", "fomc meeting", "fed policy",
    "federal funds", "fomc minutes", "fed chair", "central bank",
  ],
  "US Market": [
    "nasdaq", "s&p 500", "s&p500", "sp500", "dow jones", "russell 2000",
    "nyse", "us market", "wall street", "us equity", "us stock",
    "apple", "microsoft", "google", "alphabet", "meta", "amazon", "tesla",
    "broadcom", "qualcomm", "netflix", "salesforce", "oracle",
  ],
  "Taiwan Market": [
    "taiwan", "taiex", "twii", "hon hai", "foxconn", "mediatek", "novatek",
    "delta electronics", "asus", "acer", "realtek", "largan", "quanta",
    "compal", "wistron", "pegatron", "inventec", "台股", "台積電",
    "taiwan stock", "taiwan equity", "twse",
  ],
  "China": [
    "china policy", "china economy", "china gdp", "china exports", "china pmi",
    "trade war", "tariff", "trade tension", "us china", "china us",
    "china tech", "chinese chip", "china tariff", "chinese export",
    "beijing", "shanghai", "shenzhen", "hong kong", "hscei", "hang seng",
  ],
  "Currency": [
    "us dollar", "dxy", "dollar index", "usd", "yen", "jpy", "yuan", "rmb",
    "taiwan dollar", "twd", "fx", "forex", "exchange rate", "currency pair",
    "appreciation", "depreciation", "weak dollar", "strong dollar",
  ],
  "Bond": [
    "treasury yield", "10-year yield", "bond yield", "us treasury", "yield curve",
    "yield curve inversion", "30-year yield", "2-year yield", "treasury bond",
    "government bond", "junk bond", "credit spread", "real yield",
  ],
  "Commodity": [
    "oil price", "crude oil", "wti", "brent", "opec", "energy", "gold price",
    "silver", "copper", "aluminum", "lithium", "cobalt", "rare earth",
    "commodity", "commodities", "natural gas", "oil supply", "oil demand",
  ],
};

// ============================================================
// SECTION 7: HELPERS
// ============================================================
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[.,;:!?"'()\[\]\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(?:bloomberg|reuters|cnbc|wsj|ft|marketwatch|seeking alpha|yahoo finance|investing\.com|barron'?s|the street|zacks|benzinga|morningstar|simply wall st|fool\.com)$/i, "");
}

function detectRejectionReason(title, summary) {
  const combined = `${title} ${summary}`.toLowerCase();
  const matched = BLACKLIST_KEYWORDS.filter((kw) => combined.includes(kw.toLowerCase()));
  if (matched.length === 0) return null;
  return `包含排除關鍵字: ${matched.slice(0, 3).join(", ")}`;
}

function detectTaiwanMapping(title, summary) {
  const combined = `${title} ${summary}`.toLowerCase();
  const allSymbols = new Set();
  const allNames = new Set();

  for (const [keyword, mapping] of Object.entries(TAIWAN_SUPPLY_CHAIN_MAP)) {
    if (combined.includes(keyword.toLowerCase())) {
      for (const s of mapping.symbols) allSymbols.add(s);
      for (const n of mapping.names) allNames.add(n);
    }
  }

  return {
    symbols: Array.from(allSymbols),
    names: Array.from(allNames),
  };
}

// ============================================================
// SECTION 8: SCORING ENGINE
// ============================================================
function scoreNewsItem(title, summary) {
  const titleLower = (title || "").toLowerCase();
  const summaryLower = (summary || "").toLowerCase();
  const combined = `${titleLower} ${summaryLower}`;
  const normalizedTitle = normalizeTitle(title);

  // Step 1: Blacklist check
  const rejectionReason = detectRejectionReason(title, summary);
  const isBlacklisted = rejectionReason !== null;

  if (isBlacklisted) {
    return {
      relevanceScore: 0,
      taiwanRelevanceScore: 0,
      impactScore: 0,
      finalScore: 0,
      isBlacklisted: true,
      rejectionReason,
      category: "Other",
      relatedSectors: [],
      relatedTwSymbols: [],
      relatedTwNames: [],
      taiwanImpactSummary: "與台股無直接關聯",
      isSelected: false,
      normalizedTitle,
      duplicateGroupKey: `${normalizedTitle}`,
    };
  }

  // Step 2: relevance_score
  let highValueHits = 0;
  let highValueMatched = [];
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      highValueHits++;
      highValueMatched.push(kw);
    }
  }
  let relevanceScore = Math.min(highValueHits * 10, 60);
  if (highValueMatched.some((kw) => titleLower.includes(kw.toLowerCase()))) {
    relevanceScore += 15;
  }
  if (new Set(highValueMatched).size >= 3) {
    relevanceScore += 10;
  }
  relevanceScore = Math.min(relevanceScore, 100);
  if (highValueHits > 0 && relevanceScore < 5) relevanceScore = 5;

  // Step 3: Taiwan mapping & taiwan_relevance_score
  const twMapping = detectTaiwanMapping(title, summary);
  let taiwanHits = 0;
  let taiwanMatched = [];
  for (const kw of TAIWAN_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      taiwanHits++;
      taiwanMatched.push(kw);
    }
  }
  let taiwanRelevanceScore = Math.min(taiwanHits * 10, 60);
  if (taiwanMatched.some((kw) => titleLower.includes(kw.toLowerCase()))) {
    taiwanRelevanceScore += 20;
  }
  if (combined.includes("tsmc") || combined.includes("nvidia") || combined.includes("nvda")) {
    taiwanRelevanceScore += 10;
  }
  if (twMapping.names.length > 0) {
    taiwanRelevanceScore += Math.min(twMapping.names.length * 5, 20);
  }
  taiwanRelevanceScore = Math.min(taiwanRelevanceScore, 100);
  if (taiwanHits > 0 && taiwanRelevanceScore < 10) taiwanRelevanceScore = 10;

  // Step 4: impact_score
  let impactHits = 0;
  let impactMatched = [];
  for (const kw of IMPACT_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      impactHits++;
      impactMatched.push(kw);
    }
  }
  let impactScore = Math.min(impactHits * 15, 60);
  if (impactMatched.some((kw) => titleLower.includes(kw.toLowerCase()))) {
    impactScore += 20;
  }
  const hasEarnings = ["earnings beat", "earnings miss", "guidance", "revenue beat", "revenue miss"].some(
    (kw) => combined.includes(kw)
  );
  const hasMA = ["acquisition", "merger", "takeover", "buyback"].some(
    (kw) => combined.includes(kw)
  );
  if (hasEarnings || hasMA) {
    impactScore += 15;
  }
  impactScore = Math.min(impactScore, 100);
  if (impactHits > 0 && impactScore < 10) impactScore = 10;

  // Step 5: category detection
  let category = "Other";
  let maxCategoryScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) score++;
    }
    if (score > maxCategoryScore) {
      maxCategoryScore = score;
      category = cat;
    }
  }
  if (maxCategoryScore === 0) {
    if (combined.includes("china") || combined.includes("chinese")) category = "China";
    else if (combined.includes("oil") || combined.includes("commodity")) category = "Commodity";
    else if (combined.includes("stock") || combined.includes("market")) category = "US Market";
  }

  // Step 6: related sectors
  const relatedSectors = [];
  const sectorMap = {
    "半導體": ["semiconductor", "chip", "wafer", "foundry", "sox", "tsmc", "asml", "lam research", "applied materials", "kla", "sk hynix", "micron", "intel", "amd"],
    "AI": ["artificial intelligence", "ai chip", "ai server", "ai model", "llm", "openai", "anthropic", "ai demand", "ai infrastructure", "generative ai", "nvidia", "nvda", "blackwell", "gb200", "gb300"],
    "科技股": ["nasdaq", "apple", "microsoft", "google", "alphabet", "meta", "amazon", "tesla", "broadcom", "qualcomm"],
    "台股": ["taiwan", "taiex", "twii", "hon hai", "foxconn", "mediatek", "novatek", "delta electronics"],
    "台積電": ["tsmc", "台積電", "cowos", "advanced packaging", "2nm", "3nm", "n2", "n3"],
    "美元/匯率": ["us dollar", "dxy", "dollar index", "usd", "yen", "yuan", "rmb", "currency"],
    "美債殖利率": ["treasury yield", "10-year yield", "bond yield", "us treasury", "interest rate"],
    "Fed政策": ["federal reserve", "fed reserve", "fomc", "jerome powell", "rate hike", "rate cut"],
    "油價": ["oil price", "crude oil", "wti", "brent", "opec", "energy"],
    "中國政策": ["china policy", "china economy", "china gdp", "china exports", "china tech", "chinese chip", "trade war", "tariff"],
    "VIX/恐慌": ["vix", "volatility index", "market fear", "market panic", "fear greed"],
    "加密貨幣": ["crypto", "bitcoin", "ethereum", "blockchain", "btc", "eth"],
    "航運": ["shipping", "freight", "logistics", "container"],
    "生技醫療": ["biotech", "pharmaceutical", "fda", "clinical trial", "drug approval"],
  };
  for (const [sector, keywords] of Object.entries(sectorMap)) {
    if (keywords.some((kw) => combined.includes(kw.toLowerCase()))) {
      if (!relatedSectors.includes(sector)) relatedSectors.push(sector);
    }
  }

  // Step 7: taiwan_impact_summary
  let taiwanImpactSummary = "";
  if (twMapping.names.length > 0) {
    taiwanImpactSummary = `直接影響 ${twMapping.names.slice(0, 4).join("、")} 等台股`;
  } else if (relatedSectors.includes("台積電")) {
    taiwanImpactSummary = "直接影響台積電股價與台股電子族群";
  } else if (relatedSectors.includes("AI") && relatedSectors.includes("半導體")) {
    taiwanImpactSummary = "AI 需求動態，牽動台灣半導體與 AI 伺服器族群";
  } else if (relatedSectors.includes("半導體")) {
    taiwanImpactSummary = "半導體族群動態，影響台灣晶片與封測類股";
  } else if (relatedSectors.includes("Fed政策")) {
    taiwanImpactSummary = "Fed 政策影響資金流向，牽動外資對台股態度";
  } else if (relatedSectors.includes("美元/匯率")) {
    taiwanImpactSummary = "美元強弱影響台幣匯率與外資進出";
  } else if (relatedSectors.includes("中國政策")) {
    taiwanImpactSummary = "中國政策動向影響兩岸供應鏈與台股出口族群";
  } else if (relatedSectors.includes("美債殖利率")) {
    taiwanImpactSummary = "美債殖利率變動影響科技股估值，間接牽動台股電子類";
  } else if (relatedSectors.includes("AI")) {
    taiwanImpactSummary = "AI 相關消息，影響台灣伺服器、散熱、PCB 族群";
  } else if (relatedSectors.includes("科技股")) {
    taiwanImpactSummary = "美股科技龍頭動態，影響台股電子股開盤情緒";
  } else if (relatedSectors.includes("油價")) {
    taiwanImpactSummary = "油價波動影響台灣航運、塑化、能源類股";
  } else if (relatedSectors.length > 0) {
    taiwanImpactSummary = `${relatedSectors[0]} 相關動態，持續觀察對台股影響`;
  } else {
    taiwanImpactSummary = "國際市場動態，間接影響台股整體情緒";
  }

  // Step 8: final_score
  // V8.2: Increase taiwan weight (0.5), reduce relevance (0.3), keep impact (0.2)
  // Add AI core bonus for semiconductor/AI/Nvidia/TSMC news to ensure 5-12 selected daily
  const AI_CORE_KEYWORDS = [
    "nvidia", "nvda", "tsmc", "taiwan semiconductor", "semiconductor",
    "ai chip", "ai server", "computex", "cowos", "hbm",
    "blackwell", "gb200", "gb300", "ai infrastructure", "data center",
  ];
  const isAiCore = AI_CORE_KEYWORDS.some((kw) => titleLower.includes(kw.toLowerCase()));

  // Floor scores for AI core news to prevent 0-impact from killing good semiconductor news
  if (isAiCore) {
    if (impactScore < 20) impactScore = 20;
    if (taiwanRelevanceScore < 30) taiwanRelevanceScore = 30;
  }

  let finalScore = Math.round(
    relevanceScore * 0.3 + taiwanRelevanceScore * 0.5 + impactScore * 0.2
  );

  // AI core bonus: +8 points to push 60-69 range into selection
  if (isAiCore) {
    finalScore += 8;
  }

  finalScore = Math.min(finalScore, 100);

  // Step 9: is_selected (RELAXED from 70 to 60 in V8.2)
  const hasTwMapping = twMapping.symbols.length > 0 || twMapping.names.length > 0;
  const isSelected = !isBlacklisted &&
    finalScore >= 60 &&
    hasTwMapping &&
    category !== "Other";

  return {
    relevanceScore,
    taiwanRelevanceScore,
    impactScore,
    finalScore,
    isBlacklisted,
    rejectionReason,
    category,
    relatedSectors,
    relatedTwSymbols: twMapping.symbols,
    relatedTwNames: twMapping.names,
    taiwanImpactSummary,
    isSelected,
    normalizedTitle,
    duplicateGroupKey: `${normalizedTitle}`,
  };
}

// ============================================================
// SECTION 9: NEWS SOURCES
// ============================================================
async function fetchGNews(apiKey, logs) {
  const queries = [
    "TSMC semiconductor",
    "Nvidia AMD AI chip",
    "Federal Reserve interest rate",
    "Taiwan stock market TAIEX",
    "Nasdaq S&P 500 earnings",
  ];

  const allItems = [];
  const seenUrls = new Set();

  for (const q of queries) {
    try {
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&country=any&max=10&apikey=${apiKey}`;
      const resp = await fetch(url, { headers: { "Accept": "application/json" } });

      if (!resp.ok) {
        logs.push(`GNews query "${q}" HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      if (!data.articles || !Array.isArray(data.articles)) {
        logs.push(`GNews query "${q}" no articles`);
        continue;
      }

      for (const article of data.articles) {
        const articleUrl = article.url || "";
        if (!articleUrl || seenUrls.has(articleUrl)) continue;
        seenUrls.add(articleUrl);

        allItems.push({
          title: article.title || "",
          summary: article.description || "",
          url: articleUrl,
          publishedAt: article.publishedAt || new Date().toISOString(),
          source: article.source?.name || "GNews",
          category: "market",
        });
      }

      logs.push(`GNews query "${q}" fetched ${data.articles.length} articles`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`GNews query "${q}" exception: ${msg}`);
    }
  }

  return allItems;
}

async function fetchNewsAPI(apiKey, logs) {
  const queries = [
    "TSMC OR semiconductor OR Taiwan stock",
    "Nvidia OR AMD OR AI chip OR AI server",
    "Federal Reserve OR interest rate OR FOMC",
    "Nasdaq OR S&P 500 OR SOX index",
  ];

  const allItems = [];
  const seenUrls = new Set();

  for (const q of queries) {
    try {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=15&apiKey=${apiKey}`;
      const resp = await fetch(url, { headers: { "Accept": "application/json" } });

      if (!resp.ok) {
        logs.push(`NewsAPI query "${q}" HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      if (!data.articles || !Array.isArray(data.articles)) {
        logs.push(`NewsAPI query "${q}" no articles`);
        continue;
      }

      for (const article of data.articles) {
        const articleUrl = article.url || "";
        if (!articleUrl || seenUrls.has(articleUrl)) continue;
        seenUrls.add(articleUrl);

        if (
          !article.title ||
          article.title === "[Removed]" ||
          article.url === "https://removed.com"
        ) continue;

        allItems.push({
          title: article.title || "",
          summary: article.description || "",
          url: articleUrl,
          publishedAt: article.publishedAt || new Date().toISOString(),
          source: article.source?.name || "NewsAPI",
          category: "market",
        });
      }

      logs.push(`NewsAPI query "${q}" fetched ${data.articles.length} articles`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`NewsAPI query "${q}" exception: ${msg}`);
    }
  }

  return allItems;
}

async function fetchFinnhubNews(apiKey, logs) {
  const categories = ["general", "merger", "ipo"];
  const allItems = [];
  const seenIds = new Set();

  for (const category of categories) {
    try {
      const url = `https://finnhub.io/api/v1/news?category=${category}&minId=0&token=${apiKey}`;
      const resp = await fetch(url, { headers: { "Accept": "application/json" } });

      if (!resp.ok) {
        logs.push(`Finnhub news category "${category}" HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      if (!Array.isArray(data)) {
        logs.push(`Finnhub news category "${category}" unexpected response`);
        continue;
      }

      for (const item of data) {
        if (!item.id || seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        const publishedAt = item.datetime
          ? new Date(item.datetime * 1000).toISOString()
          : new Date().toISOString();

        allItems.push({
          title: item.headline || "",
          summary: item.summary || "",
          url: item.url || "",
          publishedAt,
          source: item.source || "Finnhub",
          category: item.category || "market",
        });
      }

      logs.push(`Finnhub category "${category}" fetched ${data.length} items`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`Finnhub category "${category}" exception: ${msg}`);
    }
  }

  return allItems;
}

function detectRelatedMarkets(title, summary) {
  const combined = `${title} ${summary}`.toLowerCase();
  const markets = [];
  if (combined.includes("taiwan") || combined.includes("taiex") || combined.includes("tsmc")) {
    markets.push("TW");
  }
  if (combined.includes("nasdaq") || combined.includes("s&p") || combined.includes("dow") || combined.includes("nyse")) {
    markets.push("US");
  }
  if (combined.includes("china") || combined.includes("hong kong") || combined.includes("shanghai")) {
    markets.push("CN");
  }
  if (combined.includes("japan") || combined.includes("nikkei") || combined.includes("topix")) {
    markets.push("JP");
  }
  if (combined.includes("europe") || combined.includes("ftse") || combined.includes("dax") || combined.includes("cac")) {
    markets.push("EU");
  }
  if (markets.length === 0) markets.push("GLOBAL");
  return markets;
}

// ============================================================
// SECTION 10: MAIN HANDLER
// ============================================================
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const logs = [];

  console.log(`[NEWS:${requestId}] start - ${now}`);

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Auth: allow x-cron-secret (cron jobs) OR Supabase Auth token (manual/admin)
    const incomingCronSecret = req.headers.get("x-cron-secret") || "";
    const envCronSecret = Deno.env.get("CRON_SECRET") || "";
    const authorization = req.headers.get("Authorization") || "";

    if (envCronSecret && incomingCronSecret !== envCronSecret) {
      // Fallback: allow Supabase Auth Bearer token for manual/admin triggers
      if (!authorization.includes("Bearer")) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Unauthorized",
            reason: "Invalid x-cron-secret and no Authorization Bearer token",
          }),
          { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
        );
      }
      // If Bearer token is present, proceed (Supabase auth verified by Deno.serve)
    }

    // Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Supabase credentials" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // API Keys
    const gnewsApiKey = Deno.env.get("GNEWS_API_KEY") || "";
    const newsApiKey = Deno.env.get("NEWS_API_KEY") || "";
    const finnhubApiKey = Deno.env.get("FINNHUB_API_KEY") || "";

    logs.push(`API keys: GNews=${Boolean(gnewsApiKey)}, NewsAPI=${Boolean(newsApiKey)}, Finnhub=${Boolean(finnhubApiKey)}`);

    // Fetch from all sources
    const rawItems = [];

    if (gnewsApiKey) {
      const gnewsItems = await fetchGNews(gnewsApiKey, logs);
      rawItems.push(...gnewsItems);
      logs.push(`GNews total: ${gnewsItems.length} items`);
    }
    if (newsApiKey) {
      const newsApiItems = await fetchNewsAPI(newsApiKey, logs);
      rawItems.push(...newsApiItems);
      logs.push(`NewsAPI total: ${newsApiItems.length} items`);
    }
    if (finnhubApiKey) {
      const finnhubItems = await fetchFinnhubNews(finnhubApiKey, logs);
      rawItems.push(...finnhubItems);
      logs.push(`Finnhub total: ${finnhubItems.length} items`);
    }

    logs.push(`Total raw items before dedup: ${rawItems.length}`);

    // Deduplicate by normalized_title + source
    const seenKeys = new Set();
    const deduped = [];
    for (const item of rawItems) {
      if (!item.url || !item.title || item.title.trim().length < 10) continue;
      const normalized = normalizeTitle(item.title);
      const key = `${normalized}|${item.source}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      deduped.push(item);
    }

    logs.push(`After dedup (normalized_title+source): ${deduped.length} items`);

    if (deduped.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "NO_NEWS_FETCHED",
          reason: "No news items fetched from any source.",
          logs,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Score each item
    const scored = [];
    let blacklistedCount = 0;

    for (const item of deduped) {
      const scoreResult = scoreNewsItem(item.title, item.summary || "");
      if (scoreResult.isBlacklisted) {
        blacklistedCount++;
        logs.push(`[BLACKLISTED] ${item.title.slice(0, 60)} | reason: ${scoreResult.rejectionReason}`);
      }
      scored.push({ ...item, ...scoreResult });
    }

    // Sort by final_score desc
    scored.sort((a, b) => b.finalScore - a.finalScore);

    logs.push(`Blacklisted: ${blacklistedCount}`);
    logs.push(`Before cap: is_selected=true: ${scored.filter((s) => s.isSelected).length}`);

    // CAP: max 80 raw news written
    let toUpsert = scored.slice(0, 80);
    logs.push(`After raw cap (max 80): ${toUpsert.length}`);

    // CAP: max 12 is_selected = true
    let selectedCount = toUpsert.filter((s) => s.isSelected).length;
    if (selectedCount > 12) {
      let selectedSoFar = 0;
      toUpsert = toUpsert.map((item) => {
        if (item.isSelected && selectedSoFar >= 12) {
          return { ...item, isSelected: false };
        }
        if (item.isSelected) selectedSoFar++;
        return item;
      });
      logs.push(`Capped is_selected to 12 (was ${selectedCount})`);
      selectedCount = 12;
    }

    logs.push(`Final is_selected=true: ${toUpsert.filter((s) => s.isSelected).length}`);
    logs.push(`Final is_selected=false: ${toUpsert.filter((s) => !s.isSelected).length}`);

    // Prepare upsert records
    if (toUpsert.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "All fetched news were blacklisted. Nothing written.",
          total_raw: rawItems.length,
          blacklisted: blacklistedCount,
          selected: 0,
          logs,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const upsertRecords = toUpsert.map((item) => ({
      source: item.source,
      title: item.title,
      summary: item.summary || null,
      url: item.url,
      published_at: item.publishedAt || null,
      category: item.category || "market",
      language: "en",
      region: "global",
      // V8.0 scoring
      relevance_score: item.relevanceScore,
      taiwan_relevance_score: item.taiwanRelevanceScore,
      impact_score: item.impactScore,
      final_score: item.finalScore,
      news_category: item.category,
      // Taiwan mapping
      related_tw_symbols: item.relatedTwSymbols.length > 0 ? item.relatedTwSymbols : null,
      related_tw_names: item.relatedTwNames.length > 0 ? item.relatedTwNames : null,
      // Deduplication
      normalized_title: item.normalizedTitle,
      duplicate_group_key: item.duplicateGroupKey,
      // Rejection
      rejection_reason: item.rejectionReason,
      // Legacy
      importance_score: Math.round(item.relevanceScore / 10),
      taiwan_impact_score: Math.round(item.taiwanRelevanceScore / 10),
      taiwan_impact_reason: `relevance=${item.relevanceScore}, taiwan=${item.taiwanRelevanceScore}, impact=${item.impactScore}, final=${item.finalScore}`,
      taiwan_impact_summary: item.taiwanImpactSummary,
      related_sectors: item.relatedSectors,
      related_markets: detectRelatedMarkets(item.title, item.summary || ""),
      is_selected: item.isSelected,
      created_at: now,
    }));

    // Batch upsert - V8.2.1: remove ignoreDuplicates to update existing scores
    const BATCH_SIZE = 50;
    let totalUpserted = 0;
    let upsertErrors = [];

    for (let i = 0; i < upsertRecords.length; i += BATCH_SIZE) {
      const batch = upsertRecords.slice(i, i + BATCH_SIZE);
      try {
        const { error: insertErr } = await supabase
          .from("market_news")
          .upsert(batch, { onConflict: "url" });

        if (insertErr) {
          const errMsg = `Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${insertErr.message}`;
          upsertErrors.push(errMsg);
          logs.push(`[UPSERT ERROR] ${errMsg}`);
        } else {
          totalUpserted += batch.length;
          logs.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} upserted: ${batch.length} items`);
        }
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        upsertErrors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} exception: ${msg}`);
        logs.push(`[UPSERT EXCEPTION] ${msg}`);
      }
    }

    const highImpactCount = toUpsert.filter((item) => item.impactScore >= 70).length;

    logs.push(`Summary: raw=${rawItems.length}, deduped=${deduped.length}, blacklisted=${blacklistedCount}, upserted=${totalUpserted}, selected=${selectedCount}, high_impact=${highImpactCount}`);

    console.log(`[NEWS:${requestId}] done - ${totalUpserted} upserted, ${selectedCount} selected, ${blacklistedCount} blacklisted`);

    return new Response(
      JSON.stringify({
        success: upsertErrors.length === 0,
        version: "V8.2.1",
        request_id: requestId,
        fetched_at: now,
        total_raw: rawItems.length,
        after_dedup: deduped.length,
        blacklisted: blacklistedCount,
        to_upsert: toUpsert.length,
        total_upserted: totalUpserted,
        selected_count: selectedCount,
        high_impact_count: highImpactCount,
        upsert_errors: upsertErrors.length > 0 ? upsertErrors : undefined,
        filter_stats: {
          relevance_ge70: toUpsert.filter((i) => i.relevanceScore >= 70).length,
          taiwan_relevance_ge50: toUpsert.filter((i) => i.taiwanRelevanceScore >= 50).length,
          impact_ge50: toUpsert.filter((i) => i.impactScore >= 50).length,
          final_score_ge60: toUpsert.filter((i) => i.finalScore >= 60).length,
        },
        sample_selected: toUpsert
          .filter((i) => i.isSelected)
          .slice(0, 5)
          .map((i) => ({
            title: i.title,
            source: i.source,
            finalScore: i.finalScore,
            category: i.category,
            sectors: i.relatedSectors,
            twSymbols: i.relatedTwSymbols,
            twNames: i.relatedTwNames,
          })),
        sample_rejected: toUpsert
          .filter((i) => !i.isSelected && !i.isBlacklisted)
          .slice(0, 3)
          .map((i) => ({
            title: i.title,
            finalScore: i.finalScore,
            category: i.category,
            rejectionReason: i.rejectionReason,
          })),
        logs,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[NEWS:${requestId}] FATAL: ${msg}`);

    return new Response(
      JSON.stringify({
        success: false,
        error: "INTERNAL_ERROR",
        reason: msg,
        logs,
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
