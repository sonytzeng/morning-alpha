import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeUnsupportedAbsolutePriceLevels } from '../supabase/functions/generate-daily-report-v7/content-integrity.ts';

test('unsupported stock price levels become evidence-relative checkpoints', () => {
  assert.equal(
    sanitizeUnsupportedAbsolutePriceLevels('台積電是否能守住2380元'),
    '台積電是否能守住前一交易日收盤價',
  );
  assert.equal(
    sanitizeUnsupportedAbsolutePriceLevels('跌破 2,300 元就代表假設失效'),
    '跌破前一交易日低點就代表假設失效',
  );
});
test('percentages and evidence-relative checkpoints remain unchanged', () => {
  assert.equal(
    sanitizeUnsupportedAbsolutePriceLevels('TSM ADR -4.07%，先看是否守住前一交易日收盤價'),
    'TSM ADR -4.07%，先看是否守住前一交易日收盤價',
  );
});
