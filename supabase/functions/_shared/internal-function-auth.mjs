function present(value) {
  return typeof value === 'string' && value.length > 0;
}

export function buildInternalFunctionHeaders({ cronSecret, serviceRoleKey, source } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (present(cronSecret)) headers['x-cron-secret'] = cronSecret;
  // Supabase opaque and legacy API keys belong in `apikey`, not in
  // `Authorization: Bearer ...`. This keeps service-to-service calls compatible
  // with both key formats while the target function retains its own auth guard.
  if (present(serviceRoleKey)) headers.apikey = serviceRoleKey;
  if (present(source)) headers['x-internal-call-source'] = source;
  return headers;
}

export function hasValidInternalCredentials(headers, { cronSecret, serviceRoleKey } = {}) {
  if (!headers || typeof headers.get !== 'function') return false;
  const presentedCronSecret = headers.get('x-cron-secret') || '';
  if (present(cronSecret) && presentedCronSecret === cronSecret) return true;

  const presentedApiKey = headers.get('apikey') || '';
  return present(serviceRoleKey) && presentedApiKey === serviceRoleKey;
}
