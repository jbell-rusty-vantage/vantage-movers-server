/** Replay-only executable. No credentials, network transport, Mongo connection, apply or production flags. */
import {readFileSync,writeFileSync} from 'node:fs';
import {inspectCapture} from './replay';
const args=process.argv.slice(2);
if(args.some(arg=>!arg.startsWith('--input=')&&!arg.startsWith('--output=')))throw new Error('Only --input=<capture.json> and --output=<report.json> are supported; replay only.');
const input=args.find(arg=>arg.startsWith('--input='))?.slice(8),output=args.find(arg=>arg.startsWith('--output='))?.slice(9);
if(!input)throw new Error('--input=<local capture JSON> is required');
try{
  const report=inspectCapture(JSON.parse(readFileSync(input,'utf8'))),json=JSON.stringify(report,null,2)+'\n';
  if(output)writeFileSync(output,json);else process.stdout.write(json);
  if(!report.discovery_complete_as_rendered)process.exitCode=2;
}catch{
  // Suppress arbitrary parser errors, HTML, contacts, URLs and credential-bearing input values.
  console.error('Pool replay refused: invalid capture schema, unreadable file, or unsupported input.');process.exitCode=1;
}
