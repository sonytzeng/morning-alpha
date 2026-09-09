/** Compatibility entrypoint for Edge and existing contract consumers.
 * The single pure implementation lives within Readdy's src/ build boundary. */
export {
  SUBSCRIBER_STATE_SCHEMA_VERSION,
  INCOMPLETE_ANALYSIS_MESSAGE,
  RECOMMENDATION_INSUFFICIENT_MESSAGE,
  parseSubscriberState,
  resolveSubscriberState,
  hasMatchingSubscriberClosingReceipt,
  createSubscriberState,
  getSubscriberReportProjection,
  SUBSCRIBER_PROJECTION_VERSION,
} from '../src/lib/subscriberReportContract.ts';
export type { SubscriberState, SubscriberReportProjection } from '../src/lib/subscriberReportContract.ts';
