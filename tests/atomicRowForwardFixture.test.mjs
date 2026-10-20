import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {atomicRowForwardFixture} from './helpers/atomicRowForwardFixture.mjs';
const bytes = readFileSync(new URL('./fixtures/production-parity-v4/atomic-row-20260924.json', import.meta.url));
test('isolated forward fixture is relative to the supplied DB date, never an expiring fixed date or altered retained evidence', () => {
  for (const date of ['2026-10-21', '2027-01-01', '2032-02-29']) {
    const fixture = JSON.parse(bytes), before = JSON.stringify(fixture), result = atomicRowForwardFixture(fixture, date);
    assert.equal(JSON.stringify(fixture), before);
    assert.equal(result.businessDate, date);
    assert.equal(result.rows.length, 11);
    const shift = Date.parse(date) - Date.parse(fixture.business_date);
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i], original = fixture.rows[i];
      assert.equal(Date.parse(row.source_timestamp) - Date.parse(original.source_timestamp), shift);
      assert.equal(row.value, original.value);
      const quote = row.raw.source_raw.quote;
      if (quote) assert.equal(quote.timestamp * 1000, Date.parse(quote.captured_at));
    }
    assert.equal(result.at(-1, '21:00:59.999Z'), new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10) + 'T21:00:59.999Z');
  }
  assert.deepEqual(readFileSync(new URL('./fixtures/production-parity-v4/atomic-row-20260924.json', import.meta.url)), bytes);
});
test('invalid, historical and same-day derivative dates are refused', () => {
  const fixture = JSON.parse(bytes);
  for (const date of ['2026-09-24', '2026-09-23', '2030-02-30', '2026-13-01', 'invalid'])
    assert.throws(() => atomicRowForwardFixture(fixture, date));
});
