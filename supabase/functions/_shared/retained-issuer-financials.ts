// Server-only release binding. This is private research context, not admission.
import packet from './retained-issuer-financials-20261030.json' with {type:'json'};
import type {IssuerFinancialPacket} from '../../../src/features/vnext/issuerFinancialIntake.ts';
export const retainedIssuerFinancials={
 // JSON is an untrusted boundary; the intake validates its pinned hash and
 // every fact before using it. Deno's inferred heterogeneous JSON union adds
 // optional undefined keys that do not exist in the actual JSON bytes.
 packet:packet as unknown as IssuerFinancialPacket,
 expectedHash:'c7388e8c74040d84a0d765aa587abc5a52efac0cfbef7e59c8cc242081793deb',
};
