import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();
import { classifyPost } from './src/lib/classifier/classify-stage';
import { loadConfirmedProfile } from './src/lib/profile/store';
import { getDb, realLlm } from './src/lib/app/server';

async function main() {
  const db = getDb();
  // using the workspace ID from one of the leads
  const { data: leads } = await db.query("select workspace_id from lead_inbox limit 1");
  const workspaceId = leads.rows[0].workspace_id;
  
  const profile = await loadConfirmedProfile(db, workspaceId);
  console.log("Loaded Profile Offerings:", profile?.offerings);

  const post = {
    source: 'test',
    externalId: 'test-1',
    url: 'http://test',
    text: 'Looking for a website designer/developer to create a premium, modern & aesthetic website for my interior design business.',
    authorHandle: 'testuser',
    authorName: 'Test',
    postedAt: new Date().toISOString(),
    matchedKeyword: 'website designer'
  };

  const services = await db.query('select * from workspace_services where workspace_id = $1', [workspaceId]);
  
  const result = await classifyPost({
    post,
    profile,
    services: services.rows,
    llm: realLlm(),
    model: 'gemini-2.5-flash'
  });

  console.log("DRAFT GENERATED:");
  console.log(result.reply_draft);
}

main().catch(console.error);
