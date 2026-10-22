// Synthetic transport receipts only; these controls do not establish SQL admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {appendCanonicalActual, V1_ACTUAL_CANONICAL_CONTRACT as contract} from '../src/features/vnext/v1ActualCanonical.ts';

const ids = {
  source_revision_id: '10000000-0000-0000-0000-000000000001',
  row_id: '20000000-0000-0000-0000-000000000001',
};
const receipt = {
  ...ids, contract, earnings_event_id: '50000000-0000-0000-0000-000000000001',
  audit_id: '60000000-0000-0000-0000-000000000001', actual_only: true,
  v1_ready: false, member_publication_approved: false,
};

for (const status of ['INSERTED', 'REPLAY']) {
  test(`canonical receipt preserves the exact string status ${status}`, async () => {
    const data = {...receipt, status};
    assert.deepEqual(await appendCanonicalActual(ids, async () => ({data, error: null})), data);
  });

  test(`canonical receipt rejects JSON array status [${status}] without retry`, async () => {
    let calls = 0;
    // A JSON round trip models the plain array a malformed RPC reply can carry.
    const data = JSON.parse(JSON.stringify({...receipt, status: [status]}));
    await assert.rejects(appendCanonicalActual(ids, async () => {
      calls++;
      return {data, error: null};
    }), /ACTUAL_SQL_RECEIPT_INVALID/);
    assert.equal(calls, 1);
  });
}
