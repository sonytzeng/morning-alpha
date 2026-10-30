// Server-only release binding. This is private research context, not admission.
import packet from './retained-issuer-financials-20261030.json' with {type:'json'};
import type {IssuerFinancialPacket} from '../../../src/features/vnext/issuerFinancialIntake.ts';
export const retainedIssuerFinancials={
 // JSON is an untrusted boundary; the intake validates its pinned hash and
 // every fact before using it. Deno's inferred heterogeneous JSON union adds
 // optional undefined keys that do not exist in the actual JSON bytes.
 packet:packet as unknown as IssuerFinancialPacket,
 expectedHash:'ba31adff1451a974b68a201c5cebfcc072b9a4b9e56c2b9c0ab088b578c2a942',
};
