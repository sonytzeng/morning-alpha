// Server-only release binding. This is private research context, not admission.
import packet from './retained-issuer-financials-20261030.json' with {type:'json'};
import supplement from './retained-issuer-financials-20261102.json' with {type:'json'};
import partial from './retained-issuer-financials-20261103-partial.json' with {type:'json'};
import basic from './retained-issuer-financials-20261103-basic.json' with {type:'json'};
import margin from './retained-issuer-financials-20261103-margin.json' with {type:'json'};
import umcCapex from './retained-issuer-financials-20261103-umc-capex.json' with {type:'json'};
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
// Only previously unbound direct basic quarters are appended. Missing quarters,
// restatement reviews and member publication remain unapproved.
export const retainedIssuerFinancialPartialSupplement={
 packet:partial as unknown as IssuerFinancialPacket,
 expectedHash:'c2edd821e88e331ce75ca3160f5e4fb9e46b757da050632b03c7720b3d631cc3',
};
// These three four-quarter basic series were already documented separately.
// Keep their original review time and required-image availability intact.
export const retainedIssuerFinancialBasicSupplement={
 packet:basic as unknown as IssuerFinancialPacket,
 expectedHash:'7d0f5ca5ab48677d10381b4134c98c9f34695145cd0982a83c2c4f311aa6ea68',
};
// Official portal percentages keep their original JSON axis locators and
// calculation basis. Two unreconciled quarters are held out of this release.
export const retainedIssuerFinancialMarginSupplement={
 packet:margin as unknown as IssuerFinancialPacket,
 expectedHash:'6464fc192100e38265605b5dd5b98042a6c8300238ac3389716cca7b3a8c1745',
};
// Fresh byte/page re-verification of the four original quarterly USD spending
// sentences. Original facts/receipt times survive; no exchange conversion.
export const retainedIssuerFinancialUmcCapexSupplement={
 packet:umcCapex as unknown as IssuerFinancialPacket,
 expectedHash:'d6f079a49d2693ab73f83e05029a714a93627ace09170f0ee87077f97b20ab7e',
};
export const retainedIssuerFinancialReleases=[retainedIssuerFinancials,retainedIssuerFinancialSupplement,retainedIssuerFinancialPartialSupplement,retainedIssuerFinancialBasicSupplement,retainedIssuerFinancialMarginSupplement,retainedIssuerFinancialUmcCapexSupplement] as const;
