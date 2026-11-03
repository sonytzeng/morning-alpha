// Fresh source/policy review with a hard independent seven-day expiry.
import packet from './retained-documented-reviews-20261103.json' with {type:'json'};
import type {IssuerDocumentedReviewPacket} from '../../../src/features/vnext/issuerDocumentedReviewIntake.ts';
export const retainedIssuerDocumentedReviews={packet:packet as unknown as IssuerDocumentedReviewPacket,expectedHash:'28acadae88dfe568f090e8850b5bc3eb7eabfc3c614a3b197b07962bbebf0c8e'};
