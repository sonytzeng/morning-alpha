import { dedupePresentedOpportunities, type PresentedOpportunity } from './decisionPresentation.ts';
import { resolvePremiumContentAvailability } from './premiumContentAvailability.ts';
import { getSubscriberReportProjection, type SubscriberReportProjection } from './subscriberReportProjection.ts';

/** Format only the canonical recommendation items. Legacy V10 status labels,
 * preview lists and QA counters cannot select or suppress a qualified item. */
export function getSubscriberOpportunityList(
  report: unknown,
  suppliedProjection?: SubscriberReportProjection,
): PresentedOpportunity[] {
  const projection = suppliedProjection ?? getSubscriberReportProjection(report);
  const premium = resolvePremiumContentAvailability(report, projection);
  if (!projection.recommendation.available || !premium.eligible) return [];
  const items = projection.recommendation.items.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  return dedupePresentedOpportunities(items, 12);
}
