// Server-only release binding. This is private research context, not admission.
import packet from './retained-issuer-financials-20261030.json' with {type:'json'};
import supplement from './retained-issuer-financials-20261102.json' with {type:'json'};
import type {IssuerFinancialPacket} from '../../../src/features/vnext/issuerFinancialIntake.ts';
export const retainedIssuerFinancials={
 // JSON is an untrusted boundary; the intake validates its pinned hash and
 // every fact before using it. Deno's inferred heterogeneous JSON union adds
 // optional undefined keys that do not exist in the actual JSON bytes.
 packet:packet as unknown as IssuerFinancialPacket,
 expectedHash:'ba31adff1451a974b68a201c5cebfcc072b9a4b9e56c2b9c0ab088b578c2a942',
};

// Each release keeps its own review time, pinned hash and seven-day expiry.
// Adding these eight observations never renews the original 38-fact packet.
export const retainedIssuerFinancialSupplement={
 packet:supplement as unknown as IssuerFinancialPacket,
 expectedHash:'9cd79b7eb5cf0ecb5686afc03999e239a2fc9c927359a752b00be0d86720a629',
};
export const retainedIssuerFinancialReleases=[retainedIssuerFinancials,retainedIssuerFinancialSupplement] as const;
