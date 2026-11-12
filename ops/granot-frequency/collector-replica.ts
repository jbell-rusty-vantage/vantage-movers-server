/** Run collector transaction proofs with synthetic configuration on the isolated local replica. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';
const database = `testvantagemovers_poolcollector${process.pid}`;
const missingEnv = `${__dirname}/.never-load.env`;
assertMissing();
function assertMissing() { if (existsSync(missingEnv)) throw new Error('Refusing dotenv file'); }
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|REDIS|UPSTASH|GOOGLE|SHEET|GRANOT|TWILIO|SENDGRID|MONGO|DOTENV/i.test(key)) delete process.env[key];
Object.assign(process.env, { TEST_MODE: 'true', TEST_MONGO_DATABASE_NAME: database, DOTENV_CONFIG_PATH: missingEnv,
  MONGO_URI: 'mongodb://127.0.0.1:27189/?replicaSet=csi01', SHEET_SYNC_MODE: 'disabled',
  GRANOT_LIFECYCLE_REPLICA_TESTS: 'true', SALES_INTELLIGENCE_DEPLOYMENT_ID: 'frequency-proof' });
async function main() {
  await mongoose.connect(process.env.MONGO_URI!, { dbName: database });
  if (mongoose.connection.host !== '127.0.0.1' || mongoose.connection.name !== database || (await mongoose.connection.db!.admin().command({ hello: 1 })).setName !== 'csi01') throw new Error('Wrong replica');
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', './ops/test-setup.ts', '--test', '--test-force-exit', '--test-concurrency=1',
      'src/services/granotLifecycle/synchronizeLead.replica.test.ts', 'src/services/granotLifecycle/automationApply.replica.test.ts', 'src/services/granotHttpCollector/poolScheduling.replica.test.ts', 'src/services/granotHttpCollector/pendingApply.replica.test.ts'], { stdio: 'inherit', env: process.env });
    const code = await new Promise<number>(resolve => child.on('exit', code => resolve(code ?? 1)));
    process.exitCode = code;
  } finally { await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
