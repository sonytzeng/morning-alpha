function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${field}_required`);
  return text;
}

export function buildLineDeliveryIdempotencyKey(input) {
  const reportDate = requiredText(input?.report_date, 'report_date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('report_date_invalid');
  const pushType = requiredText(input?.push_type, 'push_type');
  const subscriberId = requiredText(input?.subscriber_id, 'subscriber_id');
  return `${reportDate}:${pushType}:${subscriberId}`;
}
