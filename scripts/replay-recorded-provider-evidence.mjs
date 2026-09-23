#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { replayRecordedProviderEvidenceBatch } from '../supabase/functions/_shared/production-evidence-recorder.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/replay-recorded-provider-evidence.mjs /absolute/path/to/sanitized-evidence.json');
  process.exitCode = 2;
} else {
  const parsed = JSON.parse(await readFile(resolve(path), 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [];
  if (rows.length === 0) throw new Error('RECORDED_PROVIDER_EVIDENCE_ROWS_REQUIRED');
  const replay = await replayRecordedProviderEvidenceBatch(rows);
  const result = {
    deterministic: replay.deterministic,
    atomic_candidate_valid: replay.atomic_candidate_valid,
    atomic_error: replay.atomic_error,
    providers: replay.replayed.map(item => ({
      provider_key: item.provider_key,
      contract_result: item.contract_result,
      contract_reason: item.contract_reason,
      deterministic: item.deterministic,
    })),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.deterministic) process.exitCode = 1;
}
