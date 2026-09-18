import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
export function stateDirectory(root) {
  return path.resolve(root, git(root, 'rev-parse', '--git-path', 'vantage-quality').trim());
}
export function allowedFile(file) {
  return !/(^|\/)(node_modules|\.git|\.quality|dist|coverage|\.vercel)(\/|$)/.test(file)
    && (!/(^|\/)\.env(\.|$)/.test(file) || file.endsWith('.env.example'))
    && !/(^|\/)([^/]*service-account[^/]*\.json|client_secret[^/]*|credentials\.json|ringcentral-credentials\.json|[^/]*token-cache[^/]*\.json)$/i.test(file)
    && !/\.(pem|key|p12|log|tsbuildinfo)$/.test(file);
}
export function capture(root, state) {
  const files = {};
  const names = [...new Set(git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].sort();
  fs.mkdirSync(path.join(state, 'blobs'), { recursive: true });
  for (const name of names) {
    if (!allowedFile(name)) continue;
    const file = path.join(root, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile()) continue;
    const content = fs.readFileSync(file);
    const digest = hash(content);
    const blob = path.join(state, 'blobs', digest);
    if (!fs.existsSync(blob)) fs.writeFileSync(blob, content);
    files[name] = digest;
  }
  return { head: git(root, 'rev-parse', 'HEAD').trim(), files, fingerprint: hash(JSON.stringify(files)) };
}
export function changedFiles(before, after) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(name => before.files[name] !== after.files[name]);
}
export function validatedBaseline(input, output, applied, edited, state) {
  const files = { ...input.files };
  for (const name of edited) {
    const expected = output.files[name];
    const actual = applied.files[name];
    if (expected !== actual) {
      // Git may apply the repository's CRLF policy. Only accept equivalent text,
      // never an unrelated edit which arrived after the pre-application check.
      if (!expected || !actual) throw new Error(`Concurrent change while applying ${name}`);
      const expectedBytes = fs.readFileSync(path.join(state, 'blobs', expected));
      const actualBytes = fs.readFileSync(path.join(state, 'blobs', actual));
      if (expectedBytes.includes(0) || actualBytes.includes(0)
        || expectedBytes.toString('utf8').replaceAll('\r\n', '\n') !== actualBytes.toString('utf8').replaceAll('\r\n', '\n')) {
        throw new Error(`Concurrent change while applying ${name}`);
      }
    }
    if (actual) files[name] = actual;
    else delete files[name];
  }
  const ordered = Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]));
  return { head: input.head, files: ordered, fingerprint: hash(JSON.stringify(ordered)) };
}
export function materialize(snapshot, state, target) {
  for (const [name, digest] of Object.entries(snapshot.files)) {
    const file = path.join(target, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(state, 'blobs', digest), file);
  }
}
export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = readJson(file);
    if (owner && processAlive(owner.pid)) return null;
    fs.unlinkSync(file);
    return acquireLock(file);
  }
  return () => { if (readJson(file)?.pid === process.pid) fs.unlinkSync(file); };
}
export function events(state) {
  const dir = path.join(state, 'events');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => readJson(path.join(dir, name))).sort((a, b) => a.at - b.at);
}
export function activity(eventList) {
  const sessions = new Map();
  for (const event of eventList) {
    const key = `${event.provider}:${event.session}`;
    const previous = sessions.get(key);
    const active = ['start', 'prompt', 'tool-start'].includes(event.event) ? true
      : ['stop', 'end', 'interrupt'].includes(event.event) ? false : previous?.active ?? false;
    sessions.set(key, { ...event, active });
  }
  return { active: [...sessions.values()].some(session => session.active), latest: eventList.at(-1) };
}
