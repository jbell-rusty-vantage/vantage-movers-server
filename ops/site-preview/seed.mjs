import dns from 'node:dns';
import mongoose from 'mongoose';

const database = 'testvantagemovers_sitepreview';
if (process.env.TEST_MODE !== 'true' || process.env.TEST_MONGO_DATABASE_NAME !== database) {
  throw new Error('Seeding requires the explicit isolated website preview database');
}
dns.setServers((process.env.MONGO_DNS_SERVERS || '1.1.1.1,8.8.8.8').split(','));
await mongoose.connect(process.env.MONGO_URI, { dbName: database });
try {
  const db = mongoose.connection.db;
  if (db.databaseName !== database) throw new Error('Unexpected database');
  for (const slug of ['main_site', 'tbm_leads', 'tbm_prime_leads', 'top10_leads']) {
    const companies = db.collection('lead_source_companies');
    const granularities = db.collection('lead_source_granularities');
    let company = await companies.findOne({ company_slug: slug });
    if (!company) {
      company = { _id: new mongoose.Types.ObjectId(), company_slug: slug, name: slug, owner_label: slug, aliases: [slug], active: true, granularities: [], created_from: 'site_preview_seed' };
      await companies.insertOne(company);
    }
    const key = `${slug}_form`;
    let granularity = await granularities.findOne({ granularity_key: key });
    if (!granularity) {
      granularity = { _id: new mongoose.Types.ObjectId(), source_company: company._id, granularity_key: key, channel: 'form', owner_label: `${slug} preview form`, crm_label: `PREVIEW ${slug}`, aliases: [slug], source_sites: [], priority: 0, active: true, schedule_revision: 0, created_from: 'site_preview_seed' };
      await granularities.insertOne(granularity);
    }
    await companies.updateOne({ _id: company._id }, { $set: { default_form_granularity: granularity._id, default_form_granularity_key: key } });
  }
  await db.collection('testimonials').updateOne({ content_fingerprint: 'site-preview-fixture' }, { $setOnInsert: {
    source: 'BBB', reviewer_name: 'Preview fixture — not a customer review', normalized_reviewer_name: 'preview fixture', review_date: new Date('2026-10-30T12:00:00Z'), rating: 5,
    review_text: 'Synthetic preview content for layout and API verification. Not a real endorsement.', business_response: null, customer: null, published: true, featured: true,
  } }, { upsert: true });
  await db.collection('moving_carriers').updateOne({ dot_number: '0000000' }, { $setOnInsert: {
    name: 'Preview fixture — not a real carrier', normalized_name: 'preview fixture', mc_number: '0000000', active: true, created_from: 'site_preview_seed',
  } }, { upsert: true });
  console.log(JSON.stringify({ database, seededSourceCompanies: 4, syntheticContent: true }));
} finally { await mongoose.disconnect(); }
