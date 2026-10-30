import assert from 'node:assert/strict';

const origin = process.argv[2] || 'https://vantage-sites-preview-api.vercel.app';
const url = new URL(origin);
if (url.protocol !== 'https:' || !(url.hostname === 'vantage-sites-preview-api.vercel.app' || /^vantage-sites-preview-[a-z0-9]+-vantage-4d3db9ef\.vercel\.app$/.test(url.hostname))) {
  throw new Error('Only the isolated website preview API is allowed');
}
const headers = {
  'content-type': 'application/json',
  'x-api-secret': process.env.VANTAGE_API_SECRET,
  'x-vercel-protection-bypass': process.env.VANTAGE_API_PROTECTION_BYPASS,
};
async function request(path, init = {}) {
  return fetch(`${origin}${path}`, { headers, signal: AbortSignal.timeout(60000), ...init });
}
const dbResponse = await request('/db');
assert.equal(dbResponse.status, 200);
assert.ok(dbResponse.headers.get('content-type')?.includes('application/json'), 'Wait for deployment Ready and alias propagation');
const db = await dbResponse.json();
assert.equal(db.name, 'testvantagemovers_sitepreview');
for (const path of ['/api/v1/testimonials?published=true', '/api/v1/moving-carriers?active=true']) {
  const response = await request(path);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).data.items.length > 0);
}
const unauthorized = await request('/api/v1/testimonials', { headers: { ...headers, 'x-api-secret': 'invalid' } });
assert.equal(unauthorized.status, 401);
assert.equal((await request('/api/v1/analytics')).status, 404);
assert.equal((await request('/api/cron/sheet-sync')).status, 404);
const ref = `PREVIEW-${Date.now()}`;
const response = await request('/api/v1/form-leads', {
  method: 'POST',
  body: JSON.stringify({
    source_company: 'main_site', source_company_site: 'vantagehomemovers.com',
    name: 'Synthetic Preview Verification', email: `${ref.toLowerCase()}@example.com`,
    phone_number: `20255501${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`,
    pickup_zip: '10001', destination_zip: '94105', move_size: 'Studio',
    move_date: '2027-01-15', ref_no: ref, post_to_granot: true, sms_consent: true,
  }),
});
const body = await response.json();
assert.ok(response.ok, JSON.stringify({ status: response.status, error: body.error }));
const data = body.data;
assert.equal(data.crm_sync_status, 'skipped');
assert.equal(data.messaging_status, 'not_requested');
const id = data.lead._id;
const read = await request(`/api/v1/form-leads/${id}`);
assert.equal(read.status, 200);
console.log(JSON.stringify({ origin, database: db.name, leadId: id, ref, crm: data.crm_sync_status, messaging: data.messaging_status, contentAndBoundaryChecks: 'passed' }));
