// Checks the Meta / Threads setup step by step, without touching the database. Safe to run any time.
//
//   1. Are THREADS_APP_ID and THREADS_APP_SECRET accepted by Meta? (a token request with a fake code: Meta answers with an
//      error about the CODE when the app credentials are fine, and with an error about the app or secret when they are not)
//   2. If THREADS_ACCESS_TOKEN is set (a development token for a tester account, from the Meta app dashboard):
//      does the token work, and does the official keyword search return OTHER people's posts yet?
//      (Before Meta approves `threads_keyword_search` it only returns the token owner's own posts.)
//
// Usage: npm run threads:check
//        npm run threads:check -- --e2e [--dry-run]   also run the whole pipeline on what the official search finds, in a
//                                                       throwaway in-memory database (own posts allowed). --dry-run uses a fake classifier.

import { createThreadsApiCollector } from '../lib/collectors/threads-api';
import { exchangeCodeForShortToken, fetchThreadsProfile, type OAuthConfig } from '../lib/threads/oauth';
import { createFakeLlm } from '../lib/classifier/fake-llm';
import { runThreadsE2e } from '../lib/threads/e2e';
import { loadEnv, openLlm, parseArgs, run } from './common';

function line(ok: boolean | null, text: string) {
  console.log(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${text}`);
}

run(async () => {
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));
  console.log('Threads / Meta setup check\n');

  const haveId = !!env.THREADS_APP_ID;
  const haveSecret = !!env.THREADS_APP_SECRET;
  line(haveId, `THREADS_APP_ID is ${haveId ? 'set' : 'missing'}`);
  line(haveSecret, `THREADS_APP_SECRET is ${haveSecret ? 'set' : 'missing'}`);
  if (!haveId || !haveSecret) {
    console.log('\nPut both in the root .env (names only in .env.example), then run this again.');
    process.exitCode = 1;
    return;
  }
  const redirect = env.THREADS_REDIRECT_URI ?? `${(env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/threads/callback`;
  line(redirect.startsWith('https://'), `Redirect URI is ${redirect.startsWith('https://') ? 'HTTPS' : 'NOT https'}: ${redirect}`);
  if (!redirect.startsWith('https://')) console.log('      Threads sign-in needs an HTTPS redirect address that is also registered in the Meta app. That means the app must be online (deployed).');

  const cfg: OAuthConfig = { appId: env.THREADS_APP_ID!, appSecret: env.THREADS_APP_SECRET!, redirectUri: redirect, encryptionKey: env.ENCRYPTION_KEY };

  // 1. Credentials
  console.log('\n1. Do Meta accept the app id and secret?');
  try {
    await exchangeCodeForShortToken(cfg, 'this-is-not-a-real-code');
    line(null, 'Meta unexpectedly accepted a fake code. Nothing was saved.');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Secrets are removed from this message by the OAuth module.
    const aboutCode = /verification code|authorization code|code (has|is)|invalid code|expired/i.test(msg);
    const aboutApp = /client|secret|platform app|app id|app_id|application/i.test(msg) && !aboutCode;
    if (aboutCode) line(true, 'Meta recognised the app and secret and only rejected the fake code. The credentials look valid.');
    else if (aboutApp) line(false, 'Meta rejected the app id or secret. Check them in the Meta app dashboard (Threads use case, "Threads app ID" and secret).');
    else line(null, 'Could not tell from the answer. See the message below.');
    console.log(`      Meta said: ${msg.slice(0, 220)}`);
  }

  // 2. Token and permission
  console.log('\n2. Development token and the keyword search permission');
  if (!env.THREADS_ACCESS_TOKEN) {
    line(null, 'THREADS_ACCESS_TOKEN is not set, so this step is skipped.');
    console.log('      How to get one: Meta app dashboard, Use cases, Threads API, add your Threads account as a Threads tester');
    console.log('      (then accept the invite in the Threads app), and use "Generate access token" for that tester.');
    console.log('      Put it in .env as THREADS_ACCESS_TOKEN (never paste it in chat), then run this command again.');
    return;
  }
  let username: string;
  try {
    username = (await fetchThreadsProfile(cfg, env.THREADS_ACCESS_TOKEN)).username;
    line(true, `The token works. It belongs to @${username}.`);
  } catch (e) {
    line(false, `The token was refused: ${e instanceof Error ? e.message : 'unknown error'}`);
    process.exitCode = 1;
    return;
  }

  const collector = createThreadsApiCollector({ accessToken: env.THREADS_ACCESS_TOKEN, ownUsername: username });
  const r = await collector.run({ workspaceId: 'check', keywords: ['need a website', 'looking for a developer'], maxResults: 20, maxSpendUsd: 0 });
  const others = new Set(r.posts.map((p) => p.authorHandle.toLowerCase()).filter((h) => h !== username.toLowerCase()));
  if (r.status === 'failed' && /permission not approved/i.test(r.error ?? '')) {
    line(false, 'Keyword search only returns your own posts: Meta has NOT approved threads_keyword_search for this app yet. Apify stays the source.');
  } else if (r.status === 'failed' && /does not have permission/i.test(r.error ?? '')) {
    line(false, 'Meta says the app does not have the keyword search permission. The token itself works.');
    console.log('      Fix: in the Meta app dashboard open Use cases, Access the Threads API, Customize, Permissions and features, find');
    console.log('      threads_keyword_search and add it (status "Ready for testing"). Then generate a NEW access token (the old one does not');
    console.log('      carry the new permission), put it in .env as THREADS_ACCESS_TOKEN and run this check again.');
    console.log(`      Meta said: ${r.error}`);
  } else if (r.status === 'failed') {
    line(false, `The search call failed: ${r.error}`);
  } else if (others.size > 0) {
    line(true, `Keyword search returned posts from ${others.size} other account(s). The permission works: the official source can replace Apify.`);
    console.log('      Next step: enable the "Threads official API" source under Sources & Runs and compare the leads with Apify.');
  } else {
    line(null, `The search returned ${r.posts.length} post(s), none from other accounts. Not conclusive: it may be the missing permission or simply no matches. Try again later.`);
  }
  console.log(`      Searches used in this check: ${r.queriesUsed} (limit is 2,200 per 24 hours).`);

  // 3. Optional end-to-end test in a throwaway database
  if (args.e2e === true) {
    console.log('\n3. End-to-end test (throwaway database, own posts allowed, nothing is saved)');
    console.log('   Tip: first write a test post from your tester account, for example');
    console.log('   "I need a website developer for my shop, budget 300 dollars", then run this.');
    const e = await runThreadsE2e({ accessToken: env.THREADS_ACCESS_TOKEN, ownUsername: username, llm: args['dry-run'] === true ? createFakeLlm() : openLlm(env) });
    line(e.found > 0, `The official search found ${e.found} post(s); ${e.prefilterPassed} passed the pre-filter; ${e.classified} were classified.`);
    for (const l of e.leads) console.log(`      LEAD   intent ${l.intent}  ${l.service ?? ''}  @${l.handle}: ${l.text.replace(/\s+/g, ' ').slice(0, 90)}\n             AI: ${l.reason ?? ''}`);
    for (const h of e.hidden) console.log(`      HIDDEN ${h.type}  @${h.handle}: ${h.text.replace(/\s+/g, ' ').slice(0, 90)}\n             AI: ${h.why}`);
    if (e.found === 0) console.log('      Nothing found. Write a test post that contains one of the search phrases (for example "need a website"), wait a minute, and try again.');
  }
});
