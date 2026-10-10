import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: leads } = await sb.from('lead_inbox').select('author_handle, text, created_at, posted_at, intent_score').order('created_at', { ascending: false }).limit(2);
  const { data: hidden } = await sb.from('hidden_posts').select('author_handle, text, classified_at, reason').order('classified_at', { ascending: false }).limit(2);
  
  console.log('LATEST LEADS:');
  console.dir(leads, { depth: null });
  
  console.log('\nLATEST HIDDEN:');
  console.dir(hidden, { depth: null });
}

main().catch(console.error);
