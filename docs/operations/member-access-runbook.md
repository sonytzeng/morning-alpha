# Morning Alpha Member Access Runbook

## Canonical access states

- `owner`: permanent admin access with draft preview.
- `beta_full`: full published-member access before billing goes live; official trial is not consumed.
- `trialing`: 14-day full published-member access.
- `paid_active`: provider-confirmed paid access.
- `canceled`: access continues only until `access_ends_at`.
- `past_due` / `expired`: paid sections fail closed.

`get-report-payload` resolves the entitlement on the server. Browser input, URL parameters,
and user-editable Auth metadata never grant a tier.

## Launching the official 14-day trial

Change the singleton `membership_access_config.signup_mode` from `beta_full` to `trialing`
only after a real payment or manual renewal path exists. On the next authenticated request,
an existing `beta_full` account is atomically moved to a fresh 14-day trial. New accounts
start the trial on their first successful authenticated activation.

Expiry is evaluated against server time on every request. Cron is not part of the access
decision and is only suitable for reminder messages or operational reporting.

## Payment-provider adapter contract

The future verified webhook handler calls `apply_membership_billing_event_v1` with:

- verified provider and provider event ID;
- internal `user_id` resolved from provider customer metadata;
- normalized state (`active`, `past_due`, `canceled`, `expired`);
- tier and current paid-period end;
- provider customer/subscription IDs and the original event payload.

The RPC is `service_role` only. `(provider, provider_event_id)` is unique, making retries
idempotent. The webhook adapter must verify the provider signature before calling the RPC.
No provider secret may be stored in the browser or database payload.

## Editorial boundary

- `owner` receives the raw report for review.
- `beta_full`, `trialing`, and `paid_active` receive the full member payload only when
  `evaluatePremiumContentGate` returns eligible.
- Failed or incomplete reports return the public/degraded payload with explicit reason codes.
