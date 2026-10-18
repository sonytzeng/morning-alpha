import {createClient} from '@supabase/supabase-js';
const config:{anon:string}=await fetch('/__vnext_public_config').then(r=>r.json());
export const supabase=createClient(window.location.origin,config.anon,{auth:{storageKey:'vnext-local-acceptance',persistSession:true,detectSessionInUrl:false}});
