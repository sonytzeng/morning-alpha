import {createClient} from '@supabase/supabase-js';
// Non-production entry point: real SDK, Auth HTTP and signed PostgREST requests.
// This file is NEVER imported by the application build.
const config: {anon: string} = await fetch('/__academy_public_config').then(r => r.json());
export const supabase = createClient(window.location.origin, config.anon, {
  auth: {storageKey: 'academy-local-auth-acceptance', persistSession: true, detectSessionInUrl: false},
});
