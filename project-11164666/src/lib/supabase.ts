import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cttfzgvhiewfckydcrci.supabase.co';
const supabaseKey = 'sb_publishable_AysDzd1cdGje6m5svhEwFQ_pPUVL-wD';

export const supabase = createClient(supabaseUrl, supabaseKey);