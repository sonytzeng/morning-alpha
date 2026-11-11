import { createMarketWorkerGateway } from '../_shared/taiwan-market-worker-gateway.mjs';

// GitHub's OIDC signature and exact repository/workflow claims are validated by
// the handler. No Supabase service credential leaves this existing environment.
const handler = createMarketWorkerGateway({
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
});
Deno.serve(handler);
