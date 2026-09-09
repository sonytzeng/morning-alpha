/** Stable subscriber-only entrypoint. The dependency-free implementation is
 * shared with the Edge payload producer through its compatibility export. */
export { getSubscriberReportProjection, SUBSCRIBER_PROJECTION_VERSION } from './subscriberReportContract.ts';
export type { SubscriberReportProjection } from './subscriberReportContract.ts';
