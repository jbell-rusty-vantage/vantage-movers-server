/** Credential-free bounded unit suite; explicit replica proofs run separately. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const missingEnv = `${__dirname}/.never-load.env`;
if (existsSync(missingEnv)) throw new Error('Refusing dotenv file');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|REDIS|UPSTASH|GOOGLE|SHEET|GRANOT|TWILIO|SENDGRID|MONGO|DOTENV|REPLICA_TESTS/i.test(key)) delete env[key];
Object.assign(env, { TEST_MODE:'true', DOTENV_CONFIG_PATH:missingEnv, MONGO_URI:'mongodb://127.0.0.1:1/', TEST_MONGO_DATABASE_NAME:'testvantagemovers_unit', SHEET_SYNC_MODE:'disabled' });
const files = process.argv.slice(2);
const child = spawn(process.execPath, ['--import','tsx','--import','./ops/test-setup.ts','--test','--test-force-exit','--test-timeout=60000','--test-concurrency=3',
  ...(files.length ? files : ['src/**/*.test.ts','api/queues/**/*.test.ts','ops/lib/*.test.ts'])], { env, stdio:'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
