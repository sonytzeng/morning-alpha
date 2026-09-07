import { evaluateResearchQualityGate } from './research-quality-gate.ts';

const complete = () => ({ quality: { publish_status: 'ready', evidence_coverage: 100,
  unsupported_claims: [], duplicate_claims: [], contradictions: [], missing_sections: [] } });

Deno.test('research gate accepts explicitly complete counters only', () => {
  if (!evaluateResearchQualityGate(complete()).eligible) throw new Error('valid gate rejected');
  for (const field of ['unsupported_claims', 'duplicate_claims', 'contradictions', 'missing_sections']) {
    for (const value of [undefined, null, '', 0, '0', {}, false]) {
      const master = complete();
      Object.assign(master.quality, { [field]: value });
      if (evaluateResearchQualityGate(master).eligible) throw new Error(`missing/malformed ${field} passed`);
    }
  }
});

Deno.test('research gate rejects absent, nonfinite, malformed and out-of-range coverage', () => {
  for (const value of [undefined, null, '', ' ', 'NaN', NaN, Infinity, false, [], {}, 101]) {
    const master = complete();
    Object.assign(master.quality, { evidence_coverage: value });
    if (evaluateResearchQualityGate(master).eligible) throw new Error(`invalid coverage passed: ${String(value)}`);
  }
});
