import type { SubscriberReportProjection } from './subscriberReportContract';
import { humanizePublicRuntimeText } from '@/utils/publicRuntimeCopy';

// A direction badge is not an action badge. Only the already-verified public
// projection may supply its direction; this does not infer a trading action.
export function historicalReportCardPresentation(projection: SubscriberReportProjection) {
  return {
    direction: projection.analysisAvailable
      ? humanizePublicRuntimeText(projection.marketDecision.bias || projection.statusLabel)
      : '此份歷史分析資料不足',
    title: projection.analysisAvailable ? projection.title : '尚無完整歷史分析',
  };
}
