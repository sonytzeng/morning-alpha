/**
 * renderSafe — 全站共用安全渲染工具
 *
 * 所有 JSX 中可能 render 物件的地方，都必須透過這裡的函式轉成安全字串。
 * 絕不讓 React error #31 (Objects are not valid as a React child) 再次出現。
 */

// ═══════════════════════════════════════════════════
// renderSafeText — 任意值安全轉字串
// ═══════════════════════════════════════════════════

export function renderSafeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map((v) => renderSafeText(v))
      .filter(Boolean)
      .join('、');
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      (typeof obj.title === 'string' && obj.title) ||
      (typeof obj.name === 'string' && obj.name) ||
      (typeof obj.label === 'string' && obj.label) ||
      (typeof obj.symbol === 'string' && obj.symbol) ||
      (typeof obj.sector === 'string' && obj.sector) ||
      (typeof obj.point === 'string' && obj.point) ||
      (typeof obj.summary === 'string' && obj.summary) ||
      (typeof obj.reason === 'string' && obj.reason) ||
      (typeof obj.description === 'string' && obj.description) ||
      (typeof obj.text === 'string' && obj.text) ||
      '資料整理中'
    );
  }

  return String(value);
}

// ═══════════════════════════════════════════════════
// renderStockItem — 股票/標的物件安全轉顯示字串
// 處理 {name, role, reason} 這種格式
// ═══════════════════════════════════════════════════

export function renderStockItem(stock: unknown): string {
  if (!stock) return '';
  if (typeof stock === 'string') return stock;
  if (typeof stock === 'number') return String(stock);
  if (typeof stock !== 'object') return String(stock);

  const s = stock as Record<string, unknown>;
  const name = renderSafeText(s.name || s.symbol || s.title || s.ticker || s.stock_name || '');
  const role = s.role ? `（${renderSafeText(s.role)}）` : '';
  const reason = s.reason ? `：${renderSafeText(s.reason)}` : '';

  const result = `${name}${role}${reason}`.trim();
  return result || '資料整理中';
}

// ═══════════════════════════════════════════════════
// renderImpactChain — 影響鏈物件安全解析
// ═══════════════════════════════════════════════════

export interface SafeImpactChain {
  title: string;
  summary: string;
  stocks: string[];
  watchPoints: string[];
}

export function renderImpactChain(chain: unknown): SafeImpactChain {
  if (!chain || typeof chain !== 'object') {
    return {
      title: renderSafeText(chain),
      summary: '',
      stocks: [],
      watchPoints: [],
    };
  }

  const c = chain as Record<string, unknown>;

  return {
    title: renderSafeText(c.title || c.theme || c.name || c.chain_name || '影響鏈'),
    summary: renderSafeText(c.summary || c.reason || c.description || c.impact_summary || ''),
    stocks: Array.isArray(c.representative_stocks)
      ? c.representative_stocks.map(renderStockItem).filter(Boolean)
      : [],
    watchPoints: Array.isArray(c.intraday_watch_points)
      ? c.intraday_watch_points.map(renderSafeText).filter(Boolean)
      : [],
  };
}

// ═══════════════════════════════════════════════════
// renderSafeList — 陣列安全轉字串列表
// ═══════════════════════════════════════════════════

export function renderSafeList(items: unknown, separator = '、'): string {
  if (!items) return '';
  if (typeof items === 'string') return items;
  if (Array.isArray(items)) {
    return items.map(renderSafeText).filter(Boolean).join(separator);
  }
  return renderSafeText(items);
}

// ═══════════════════════════════════════════════════
// renderSafeListItem — 提取陣列中單一項目的安全字串
// 處理 representative_stocks[0] 可能是物件的情況
// ═══════════════════════════════════════════════════

export function renderSafeListItem(arr: unknown, index: number): string {
  if (!Array.isArray(arr)) return '';
  const item = arr[index];
  if (item === undefined || item === null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number') return String(item);
  if (typeof item === 'object') return renderStockItem(item);
  return String(item);
}

// ═══════════════════════════════════════════════════
// renderSafeField — 從物件安全提取字串欄位
// ═══════════════════════════════════════════════════

export function renderSafeField(obj: unknown, fields: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  for (const field of fields) {
    const val = o[field];
    if (typeof val === 'string' && val.trim()) return val;
    if (typeof val === 'number') return String(val);
  }
  return '';
}

// ═══════════════════════════════════════════════════
// trySafeRender — 安全渲染 Wrapper
// 給 JSX 區塊用的最後防線：就算資料格式完全異常也不白屏
// ═══════════════════════════════════════════════════

export function trySafeRender<T>(
  fn: () => T,
  fallback: T,
  onError?: (err: unknown) => void,
): T {
  try {
    return fn();
  } catch (err) {
    if (onError) onError(err);
    console.warn('[renderSafe] trySafeRender caught error, using fallback:', err);
    return fallback;
  }
}

// ═══════════════════════════════════════════════════
// safeText — 任意值安全轉字串，含 fallback
// ═══════════════════════════════════════════════════

export function safeText(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map((v) => safeText(v, ''))
      .filter(Boolean)
      .join('、');
  }

  if (typeof value === 'object') {
    // Never render an object directly — use JSON.stringify as last resort
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  }

  return String(value);
}