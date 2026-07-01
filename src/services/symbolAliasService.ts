/**
 * Morning Alpha — Symbol Alias Service
 *
 * Many market_data sources use different symbol names than what the frontend expects.
 * This service maps all known aliases to a canonical symbol, ensuring that:
 *   TAIEX / TWSE / ^TWII → TAIEX
 *   TXF / TXF1 / 台指期 → TXF
 *   2330 / 2330.TW / TSMC_TW → 2330
 *   etc.
 *
 * Usage:
 *   const canonical = resolveSymbol('TWSE');        // → 'TAIEX'
 *   const item = findBySymbolAlias(marketData, '2330');  // finds 2330, 2330.TW, TSMC_TW
 */

export interface SymbolAliasGroup {
  canonical: string;
  aliases: string[];
}

/**
 * All known symbol alias groups, ordered by priority.
 * When looking up, the first matching group's canonical symbol is returned.
 */
export const SYMBOL_ALIAS_GROUPS: SymbolAliasGroup[] = [
  {
    canonical: 'TAIEX',
    aliases: ['TAIEX', 'TWSE', '^TWII', '加權指數', 'TAIWAN WEIGHTED', 'TW'],
  },
  {
    canonical: 'TXF',
    aliases: ['TXF', 'TX', 'TXF1', '台指期', 'Taiwan Futures', 'TX01', 'TXF*1'],
  },
  {
    canonical: '2330',
    aliases: ['2330', '2330.TW', 'TSMC_TW', '台積電', 'TSMC Taiwan', '2330 TT'],
  },
  {
    canonical: 'SPX',
    aliases: ['SPX', '^GSPC', 'S&P500', 'S&P 500', 'SP500', 'SPX.INDX'],
  },
  {
    canonical: 'SOX',
    aliases: ['SOX', '^SOX', '費半', 'Philadelphia Semiconductor', 'SOX.INDX', 'SOXX'],
  },
  {
    canonical: 'NVDA',
    aliases: ['NVDA', 'Nvidia', 'NVIDIA', 'NVDA.US'],
  },
  {
    canonical: 'TSM',
    aliases: ['TSM', 'TSM ADR', 'TSMC ADR', 'TSM.US'],
  },
  {
    canonical: 'VIX',
    aliases: ['VIX', '^VIX', 'VIX.INDX', 'CBOE VIX'],
  },
  {
    canonical: 'DXY',
    aliases: ['DXY', 'USDX', '美元指數', 'US Dollar Index', 'DXY.INDX'],
  },
  {
    canonical: 'US10Y',
    aliases: ['US10Y', 'TNX', '美國10年債', 'US 10Y', '10Y Treasury', '^TNX'],
  },
];

// ════════════════════════════════════════════
// Alias Resolution
// ════════════════════════════════════════════

/**
 * Resolve a raw symbol string to its canonical form.
 * Returns the original string if no alias match found.
 */
export function resolveSymbol(raw: string): string {
  if (!raw) return raw;
  const normalized = raw.trim();

  for (const group of SYMBOL_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      if (normalized.toLowerCase() === alias.toLowerCase()) {
        return group.canonical;
      }
    }
  }

  return normalized;
}

/**
 * Get all aliases (including canonical) for a given canonical symbol.
 */
export function getAliasesForSymbol(canonical: string): string[] {
  for (const group of SYMBOL_ALIAS_GROUPS) {
    if (group.canonical === canonical) {
      return [group.canonical, ...group.aliases.filter((a) => a !== group.canonical)];
    }
  }
  return [canonical];
}

/**
 * Find a market_data item by canonical symbol, searching across all aliases.
 */
export function findBySymbolAlias<T extends { symbol: string }>(
  items: T[] | null | undefined,
  canonical: string,
): T | null {
  if (!items || items.length === 0) return null;

  const aliases = getAliasesForSymbol(canonical);
  const aliasSet = new Set(aliases.map((a) => a.toLowerCase()));

  for (const item of items) {
    if (aliasSet.has(item.symbol.toLowerCase())) {
      return item;
    }
  }

  return null;
}

/**
 * Find the change_percent for a canonical symbol from market_data items.
 * Returns null if symbol not found or change_percent is null/undefined.
 */
export function findChangePercent<T extends { symbol: string; change_percent?: number | null }>(
  items: T[] | null | undefined,
  canonical: string,
): number | null {
  const item = findBySymbolAlias(items, canonical);
  if (!item || item.change_percent === null || item.change_percent === undefined) return null;
  return item.change_percent;
}

/**
 * Check if a canonical symbol exists in market_data items (via alias matching).
 */
export function hasSymbolAlias<T extends { symbol: string }>(
  items: T[] | null | undefined,
  canonical: string,
): boolean {
  return findBySymbolAlias(items, canonical) !== null;
}

/**
 * Get the display name for a canonical symbol.
 */
export function getSymbolDisplayName(canonical: string): string {
  switch (canonical) {
    case 'TAIEX': return '加權指數';
    case 'TXF': return '台指期';
    case '2330': return '台積電';
    case 'SPX': return 'S&P 500';
    case 'SOX': return '費城半導體';
    case 'NVDA': return 'NVIDIA';
    case 'TSM': return '台積電 ADR';
    case 'VIX': return '恐慌指數';
    case 'DXY': return '美元指數';
    case 'US10Y': return '美國 10 年債';
    default: return canonical;
  }
}