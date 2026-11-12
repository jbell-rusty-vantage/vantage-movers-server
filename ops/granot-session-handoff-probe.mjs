/** Read-only live qualification using an automation session as the test user, never as the lookup login. */
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

async function main() {
  const job = process.argv.find(arg => arg.startsWith('--job='))?.slice(6);
  if (!process.argv.includes('--run') || !/^\d{1,20}$/.test(job ?? '')) throw new Error('explicit_run_required');
  const load = async path => { const m = await import(path); return m.default ?? m; };
  const { configureMongoDnsServers } = await load('../src/db.ts');
  const { MongoLeaseStore } = await load('../src/services/durableWork/leases.ts');
  const { SheetSyncLease } = await load('../src/models/SheetSyncLease.ts');
  const { openGranotAuthenticatedSession, openGranotNetworkSession } = await load('../src/services/granotHttpCollector/index.ts');
  const { readGranotCredentials, readGranotNetworkCredentials } = await load('../src/services/granotHttpCollector/credentials.ts');
  const { searchGranotJobInUserSession } = await load('../src/services/granotHttpCollector/sessionJobLink.ts');
  configureMongoDnsServers(); mongoose.set('autoIndex', false); mongoose.set('autoCreate', false);
  await mongoose.connect(process.env.MONGO_URI, { dbName: 'vantagemovers', autoIndex: false, autoCreate: false, maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  const store = new MongoLeaseStore(SheetSyncLease);
  let lease = await store.acquire({ scope: 'granot:automation:account', owner: `session-handoff-proof:${randomUUID()}`, now: new Date(), ttl_ms: 120000 });
  if (!lease) throw new Error('lease_busy');
  const cookies = new Map(); let requests = 0, lookupUserLogins = 0, lookupPhase = false;
  const transport = async (input, init) => {
    if (++requests > 20 || new URL(String(input)).origin !== 'https://eagle.hellomoving.com') throw new Error('request_budget');
    const renewed = await store.renew({ token: lease, now: new Date(), ttl_ms: 120000 });
    if (!renewed) throw new Error('lease_lost'); lease = renewed;
    if (lookupPhase && String(input).includes('mp~loginret~')) lookupUserLogins++;
    const response = await fetch(input, init);
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';', 1)[0], at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1)); }
    return response;
  };
  try {
    // The test needs a real source session. No other user's password or browser data is read.
    const source = await openGranotAuthenticatedSession(readGranotCredentials(), { fetch: transport, timeoutMs: 10000 });
    const sourceMenu = await source.request(`/wc.dll?mv~mainmenuwc~${source.sessionToken}~LOGIN`);
    const originalUser = /Logged\s+in\s+as\s+([a-z\d._@-]+)/i.exec(cheerio.load(sourceMenu)('body').text().replace(/\s+/g, ' '))?.[1];
    if (!originalUser) throw new Error('identity_unverified');
    const browserCookies = [...cookies];
    lookupPhase = true;
    const network = await openGranotNetworkSession(readGranotNetworkCredentials(), { fetch: transport, timeoutMs: 10000 });
    const result = await searchGranotJobInUserSession(network.request, source.sessionToken, job, originalUser);
    const require = createRequire(new URL('../../vantage-admin/package.json', import.meta.url));
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    let browserJobMatches = false, popupClosed = false;
    try {
      const context = await browser.newContext();
      await context.addCookies(browserCookies.map(([name, value]) => ({ name, value, domain: 'eagle.hellomoving.com', path: '/', sameSite: 'Lax' })));
      const page = await context.newPage();
      await page.route('https://outreach-probe.invalid/', route => route.fulfill({ contentType: 'text/html', body: `<a target="_blank" rel="noopener noreferrer" href="${result.url}">Open</a>` }));
      await page.goto('https://outreach-probe.invalid/');
      const popupPromise = context.waitForEvent('page'); await page.getByRole('link', { name: 'Open' }).click(); const popup = await popupPromise;
      await popup.waitForURL(/eagle\.hellomoving\.com/, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const text = await popup.locator('body').innerText({ timeout: 2000 }).catch(() => 'closed');
      browserJobMatches = new RegExp(`Job\\s*No:\\s*P?${job}(?!\\d)`, 'i').test(text);
      popupClosed = popup.isClosed();
    } finally { await browser.close(); }
    // Diagnostic only, AFTER the browser check: a main-menu read clears the result context's active job.
    const resultContext = result.url.split('~').at(-1);
    const menu = await network.request(`/wc.dll?mv~mainmenuwc~${resultContext}~LOGIN`);
    const resultUser = /Logged\s+in\s+as\s+([a-z\d._@-]+)/i.exec(cheerio.load(menu)('body').text().replace(/\s+/g, ' '))?.[1];
    const identityPreserved = !!resultUser && resultUser.toUpperCase() === originalUser.toUpperCase();
    let wrongAccountRejected = false;
    try { await searchGranotJobInUserSession(network.request, source.sessionToken, job, 'EXPECTED_DIFFERENT_ACCOUNT'); }
    catch (error) { wrongAccountRejected = error.reason === 'account_mismatch'; }
    const ok = browserJobMatches && !popupClosed && identityPreserved && lookupUserLogins === 0 && wrongAccountRejected;
    console.log(JSON.stringify({ ok, browser_job_matches: browserJobMatches, browser_cookie_policy: 'explicit_Lax', popup_closed: popupClosed, resulting_identity_preserved: identityPreserved, lookup_user_login_submissions: lookupUserLogins, wrong_account_rejected: wrongAccountRejected, requests, domain_mutations: 0, actual_rep_templates_qualified: false }));
    if (!ok) process.exitCode = 1;
  } finally { await store.release({ token: lease, now: new Date() }); }
}
main().catch(() => { console.error(JSON.stringify({ ok: false, code: 'private_probe_error' })); process.exitCode = 1; }).finally(() => mongoose.disconnect());
