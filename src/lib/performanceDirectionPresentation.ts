// Display translation only. Never changes the persisted verdict or statistics.
export function performanceClosingDirection(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['up', 'bullish', 'positive'].includes(normalized)) return '收盤偏多';
  if (['down', 'bearish', 'negative'].includes(normalized)) return '收盤偏空';
  if (['flat', 'neutral', 'sideways'].includes(normalized)) return '收盤震盪';
  return null;
}
