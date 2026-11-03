// Append-only current release. Preserve the separately tested six-packet review.
import {retainedIssuerFinancialReleases as prior} from './retained-issuer-financials.ts';
import packet from './retained-issuer-financials-20261103-novatek.json' with {type:'json'};
import type {IssuerFinancialPacket} from '../../../src/features/vnext/issuerFinancialIntake.ts';

// Only three directly reported basic quarters. Q4's unspecified EPS basis is
// held out; this does not establish a four-quarter series or publication rights.
export const retainedIssuerFinancialNovatekSupplement={
 packet:packet as unknown as IssuerFinancialPacket,
 expectedHash:'5353115982113d6bf360c0860d67d5aaa869053839be67d92407666a26f875b5',
};
export const retainedIssuerFinancialReleases=[...prior,retainedIssuerFinancialNovatekSupplement] as const;
