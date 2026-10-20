// Isolated derivative only. The retained Production fixture is never mutated.
import assert from 'node:assert/strict';
const dayMs = 86_400_000;
function day(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  const at = Date.parse(value + 'T00:00:00.000Z');
  assert(Number.isFinite(at));
  assert.equal(new Date(at).toISOString().slice(0, 10), value);
  return at;
}
export function atomicRowForwardFixture(fixture, businessDate) {
  const delta = day(businessDate) - day(fixture.business_date);
  assert(delta > 0 && delta % dayMs === 0, 'ATOMIC_TEST_FORWARD_DATE_REQUIRED');
  const shifted = value => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
      return new Date(day(value.slice(0, 10)) + delta).toISOString().slice(0, 10) + value.slice(10);
    }
    if (Array.isArray(value)) return value.map(shifted);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, key === 'timestamp' && Number.isSafeInteger(item) ? item + delta / 1000 : shifted(item)]));
    return value;
  };
  return {businessDate, rows: shifted(fixture.rows),
    at: (offsetDays, time) => {
      assert(Number.isInteger(offsetDays));
      assert.match(time, /^\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      return new Date(day(businessDate) + offsetDays * dayMs).toISOString().slice(0, 10) + 'T' + time;
    }};
}
