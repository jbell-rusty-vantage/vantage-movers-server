/** Fixed disposable replica only; provider credentials/dotenv never reach the worker test. */
import { MongoClient } from 'mongodb';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
async function main() {
  const uri = 'mongodb://127.0.0.1:27216/?replicaSet=capacityp1';
  const database = `testvantagemovers_w5recovery${process.pid}`;
  const dotenv = resolve('ops/capacity/.w5-no-dotenv.env');
  if (existsSync(dotenv)) throw new Error('Refusing dotenv file');
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const hello = await client.db(database).admin().command({ hello: 1 });
    if (hello.setName !== 'capacityp1' || !hello.isWritablePrimary || !Array.isArray(hello.hosts) || !hello.hosts.length
      || [...hello.hosts, ...(hello.passives ?? []), ...(hello.arbiters ?? [])].some(host => !/^(127\.0\.0\.1|localhost):\d+$/.test(String(host)))) throw new Error('Refusing nonlocal replica');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|GOOGLE|SHEET|GRANOT|TWILIO|SENDGRID|RESEND|SMTP|MONGO|DOTENV/i.test(key)) delete env[key];
    Object.assign(env, { TEST_MODE: 'true', TEST_MONGO_DATABASE_NAME: database, MONGO_URI: uri, DOTENV_CONFIG_PATH: dotenv,
      SHEET_SYNC_MODE: 'disabled', GRANOT_LIFECYCLE_REPLICA_TESTS: 'true', SALES_INTELLIGENCE_DEPLOYMENT_ID: 'w5-local-proof' });
    try {
      const child = spawn(process.execPath, ['--import', 'tsx', '--import', './ops/test-setup.ts', '--test', '--test-concurrency=1', 'src/services/granotHttpCollector/runRecovery.replica.test.ts'], { env, stdio: 'inherit' });
      process.exitCode = await new Promise<number>((resolveExit, reject) => { child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1)); });
    } finally { await client.db(database).dropDatabase(); }
  } finally { await client.close(); }
}
main().catch(() => { console.error('W5 local replica harness failed; no provider calls allowed.'); process.exitCode = 1; });
